const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { query, sql } = require('../db');
const { authenticate } = require('../middleware/auth');
const { auditLog } = require('../utils/auditLog');
const { notify } = require('../utils/notify');

const validate = (vs) => async (req, res, next) => {
  await Promise.all(vs.map((v) => v.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
};

router.use(authenticate);

const isAdminRole = (role) => ['admin', 'platform_admin', 'super_admin'].includes(role);

const recordTaskKpiOnCompletion = async ({ envId, userId }) => {
  const taskRateResult = await query(
    `SELECT ISNULL(
      100.0 * SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
      0
    ) AS completion_rate
     FROM tasks
     WHERE env_id = @envId AND assigned_to = @userId`,
    {
      envId: { type: sql.UniqueIdentifier, value: envId },
      userId: { type: sql.UniqueIdentifier, value: userId },
    }
  );

  const rate = Number(taskRateResult.recordset[0]?.completion_rate || 0);
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  await query(
    `INSERT INTO kpi_records
      (id, env_id, user_id, metric_key, metric_value, domain, source, unit, target_value, period_label, period_start, period_end)
     VALUES
      (NEWID(), @envId, @userId, 'task_completion_rate', @metricValue, @domain, 'AUTO_INGESTED', '%', 85, @periodLabel, @periodStart, @periodEnd)`,
    {
      envId: { type: sql.UniqueIdentifier, value: envId },
      userId: { type: sql.UniqueIdentifier, value: userId },
      metricValue: { type: sql.Decimal(10, 4), value: rate },
      domain: { type: sql.NVarChar(10), value: 'CA' },
      periodLabel: { type: sql.NVarChar(50), value: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` },
      periodStart: { type: sql.Date, value: periodStart },
      periodEnd: { type: sql.Date, value: periodEnd },
    }
  );
};

// ── GET /api/tasks ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { projectId, assignedTo, status } = req.query;
    let whereClause = 'WHERE t.env_id = @envId';
    const params = { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } };

    if (projectId) {
      whereClause += ' AND t.project_id = @pid';
      params.pid = { type: sql.UniqueIdentifier, value: projectId };
    }
    if (assignedTo) {
      whereClause += ' AND t.assigned_to = @assignedTo';
      params.assignedTo = { type: sql.UniqueIdentifier, value: assignedTo };
    }
    if (status) {
      whereClause += ' AND t.status = @status';
      params.status = { type: sql.NVarChar, value: status };
    }

    const result = await query(
      `SELECT t.id, t.title, t.description, t.priority, t.status, t.type, t.due_date, t.created_at, t.completed_at,
              t.force_closed_reason, t.project_id,
              cb.full_name as created_by_name, cb.team as created_by_team,
              ab.full_name as assigned_to_name, ab.team as assigned_to_team, ab.avatar_initials
       FROM tasks t
       JOIN users cb ON cb.id = t.created_by
       LEFT JOIN users ab ON ab.id = t.assigned_to
       ${whereClause}
       ORDER BY
         CASE t.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
         t.due_date ASC, t.created_at DESC`,
      params
    );

    const taskIds = result.recordset.map((t) => t.id);
    let comments = [];
    let dependencies = [];
    if (taskIds.length) {
      const inParams = taskIds.map((_, i) => `@id${i}`).join(',');
      const depParams = taskIds.reduce((acc, id, i) => ({ ...acc, [`id${i}`]: { type: sql.UniqueIdentifier, value: id } }), {});
      comments = (await query(
        `SELECT c.id, c.task_id, c.comment_text, c.created_at, u.full_name as author_name, u.team as author_team
         FROM task_comments c
         JOIN users u ON u.id = c.author_id
         WHERE c.task_id IN (${inParams})
         ORDER BY c.created_at ASC`,
        depParams
      )).recordset;

      dependencies = (await query(
        `SELECT td.task_id, td.depends_on_task_id
         FROM task_dependencies td
         WHERE td.task_id IN (${inParams})`,
        depParams
      )).recordset;
    }

    const commentsByTask = comments.reduce((acc, c) => {
      if (!acc[c.task_id]) acc[c.task_id] = [];
      acc[c.task_id].push(c);
      return acc;
    }, {});
    const depsByTask = dependencies.reduce((acc, d) => {
      if (!acc[d.task_id]) acc[d.task_id] = [];
      acc[d.task_id].push(d.depends_on_task_id);
      return acc;
    }, {});

    const tasks = result.recordset.map((t) => ({
      ...t,
      comments: commentsByTask[t.id] || [],
      blockedBy: depsByTask[t.id] || [],
    }));

    res.json({ success: true, tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch tasks.' });
  }
});

// ── POST /api/tasks ───────────────────────────────────────────────────────
router.post('/',
  validate([
    body('title').trim().isLength({ min: 3, max: 200 }).withMessage('Task title must be 3–200 characters.'),
    body('priority').isIn(['Critical', 'High', 'Medium', 'Low']).withMessage('Priority must be Critical, High, Medium, or Low.'),
    body('type').optional().isIn(['DATA_TASK', 'FINANCIAL_REVIEW', 'MODEL_VALIDATION', 'DOCUMENTATION', 'OTHER']).withMessage('Invalid task type.'),
    body('dueDate').optional().isDate().withMessage('Valid due date is required.'),
  ]),
  async (req, res) => {
    try {
      const { title, description, priority, type = 'OTHER', dueDate, assignedTo, projectId, blockedBy = [] } = req.body;

      // Validate due date not in the past
      if (dueDate && new Date(dueDate) < new Date(new Date().toDateString())) {
        return res.status(400).json({ success: false, message: "Due date cannot be earlier than today." });
      }

      // Verify assignee is in env
      if (assignedTo) {
        const assigneeCheck = await query(
          `SELECT id FROM users WHERE id = @id AND env_id = @envId AND status = 'active'`,
          {
            id:    { type: sql.UniqueIdentifier, value: assignedTo },
            envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          }
        );
        if (!assigneeCheck.recordset.length) {
          return res.status(400).json({ success: false, message: 'Assigned user not found.' });
        }
      }

      if (projectId && dueDate) {
        const timeline = await query(
          `SELECT start_date, end_date FROM projects WHERE id = @projectId AND env_id = @envId`,
          {
            projectId: { type: sql.UniqueIdentifier, value: projectId },
            envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          }
        );
        if (!timeline.recordset.length) {
          return res.status(404).json({ success: false, message: 'Project not found.' });
        }
        const { start_date, end_date } = timeline.recordset[0];
        if (start_date && new Date(dueDate) < new Date(start_date)) {
          return res.status(400).json({ success: false, message: 'Task due date cannot be before project start date.' });
        }
        if (end_date && new Date(dueDate) > new Date(end_date)) {
          return res.status(400).json({ success: false, message: 'Task due date cannot be after project end date.' });
        }
      }

      const result = await query(
        `INSERT INTO tasks (id, project_id, env_id, title, description, priority, type, status, assigned_to, created_by, due_date)
         OUTPUT INSERTED.*
         VALUES (NEWID(), @pid, @envId, @title, @desc, @priority, @type, 'todo', @assignedTo, @createdBy, @dueDate)`,
        {
          pid:       { type: sql.UniqueIdentifier, value: projectId || null },
          envId:     { type: sql.UniqueIdentifier, value: req.user.env_id },
          title:     { type: sql.NVarChar, value: title },
          desc:      { type: sql.NVarChar(sql.MAX), value: description || null },
          priority:  { type: sql.NVarChar, value: priority },
          type:      { type: sql.NVarChar(30), value: type },
          assignedTo:{ type: sql.UniqueIdentifier, value: assignedTo || null },
          createdBy: { type: sql.UniqueIdentifier, value: req.user.id },
          dueDate:   { type: sql.Date, value: dueDate ? new Date(dueDate) : null },
        }
      );

      const task = result.recordset[0];

      if (projectId && blockedBy.length) {
        for (const depId of blockedBy) {
          await query(
            `INSERT INTO task_dependencies (id, env_id, project_id, task_id, depends_on_task_id)
             VALUES (NEWID(), @envId, @projectId, @taskId, @depId)`,
            {
              envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
              projectId: { type: sql.UniqueIdentifier, value: projectId },
              taskId: { type: sql.UniqueIdentifier, value: task.id },
              depId: { type: sql.UniqueIdentifier, value: depId },
            }
          );
        }
      }

      // Notify assignee
      if (assignedTo && assignedTo !== req.user.id) {
        await notify({
          userId: assignedTo,
          type: 'task_assigned',
          title: 'New Task Assigned',
          body: `${req.user.full_name} assigned you a task: "${title}"`,
          refId: task.id,
          io: req.app.get('io'),
        });
      }

      await auditLog({
        envId: req.user.env_id,
        actorId: req.user.id,
        actionType: 'task_created',
        targetType: 'task',
        targetId: task.id,
        targetName: title,
        metadata: { priority, assignedTo, type, blockedByCount: blockedBy.length },
        ipAddress: req.ip,
      });

      res.status(201).json({ success: true, task });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Failed to create task.' });
    }
  }
);

// ── PATCH /api/tasks/:id/status ───────────────────────────────────────────
router.patch('/:id/status',
  validate([
    body('status').isIn(['todo', 'in_progress', 'in_review', 'done']).withMessage('Invalid status.'),
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const taskResult = await query(
        `SELECT t.*, u.full_name as assigned_name FROM tasks t
         LEFT JOIN users u ON u.id = t.assigned_to
         WHERE t.id = @id AND t.env_id = @envId`,
        {
          id:    { type: sql.UniqueIdentifier, value: id },
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        }
      );
      if (!taskResult.recordset.length) return res.status(404).json({ success: false, message: 'Task not found.' });

      const task = taskResult.recordset[0];
      const completedAt = status === 'done' ? 'GETUTCDATE()' : 'NULL';

      await query(
        `UPDATE tasks
         SET status = @status, completed_at = ${status === 'done' ? 'GETUTCDATE()' : 'NULL'}, updated_at = GETUTCDATE()
         WHERE id = @id`,
        {
          status: { type: sql.NVarChar, value: status },
          id:     { type: sql.UniqueIdentifier, value: id },
        }
      );

      // Notify task creator if someone else updates it
      if (task.created_by !== req.user.id) {
        await notify({
          userId: task.created_by,
          type: 'task_updated',
          title: 'Task Status Updated',
          body: `"${task.title}" was moved to ${status.replace('_', ' ')} by ${req.user.full_name}.`,
          refId: id,
          io: req.app.get('io'),
        });
      }

      await auditLog({
        envId: req.user.env_id,
        actorId: req.user.id,
        actionType: 'task_status_updated',
        targetType: 'task',
        targetId: id,
        targetName: task.title,
        metadata: { from: task.status, to: status },
        ipAddress: req.ip,
      });

      if (status === 'done' && task.assigned_to) {
        await recordTaskKpiOnCompletion({ envId: req.user.env_id, userId: task.assigned_to });
      }

      res.json({ success: true, message: `Task moved to ${status}.` });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to update task status.' });
    }
  }
);

router.post('/:id/comments',
  validate([
    body('comment').trim().isLength({ min: 1 }).withMessage('Comment is required.'),
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { comment } = req.body;
      const taskResult = await query(
        `SELECT id, project_id, title FROM tasks WHERE id = @id AND env_id = @envId`,
        {
          id: { type: sql.UniqueIdentifier, value: id },
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        }
      );
      if (!taskResult.recordset.length) return res.status(404).json({ success: false, message: 'Task not found.' });

      const inserted = await query(
        `INSERT INTO task_comments (id, task_id, author_id, comment_text)
         OUTPUT INSERTED.id, INSERTED.task_id, INSERTED.comment_text, INSERTED.created_at
         VALUES (NEWID(), @taskId, @authorId, @comment)`,
        {
          taskId: { type: sql.UniqueIdentifier, value: id },
          authorId: { type: sql.UniqueIdentifier, value: req.user.id },
          comment: { type: sql.NVarChar(sql.MAX), value: comment.trim() },
        }
      );

      await auditLog({
        envId: req.user.env_id,
        actorId: req.user.id,
        actionType: 'task_comment_added',
        targetType: 'task',
        targetId: id,
        targetName: taskResult.recordset[0].title,
        ipAddress: req.ip,
      });

      res.status(201).json({
        success: true,
        comment: {
          ...inserted.recordset[0],
          author_name: req.user.full_name,
          author_team: req.user.team,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to add comment.' });
    }
  }
);

router.patch('/:id/admin', authenticate, async (req, res) => {
  try {
    if (!isAdminRole(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    const { id } = req.params;
    const { assignedTo, priority, forceCloseReason } = req.body;
    const taskResult = await query(
      `SELECT id, title, status FROM tasks WHERE id = @id AND env_id = @envId`,
      {
        id: { type: sql.UniqueIdentifier, value: id },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );
    if (!taskResult.recordset.length) return res.status(404).json({ success: false, message: 'Task not found.' });

    await query(
      `UPDATE tasks
       SET assigned_to = COALESCE(@assignedTo, assigned_to),
           priority = COALESCE(@priority, priority),
           status = CASE WHEN @forceCloseReason IS NOT NULL THEN 'done' ELSE status END,
           force_closed_reason = COALESCE(@forceCloseReason, force_closed_reason),
           closed_by = CASE WHEN @forceCloseReason IS NOT NULL THEN @adminId ELSE closed_by END,
           completed_at = CASE WHEN @forceCloseReason IS NOT NULL THEN GETUTCDATE() ELSE completed_at END,
           updated_at = GETUTCDATE()
       WHERE id = @id`,
      {
        id: { type: sql.UniqueIdentifier, value: id },
        assignedTo: { type: sql.UniqueIdentifier, value: assignedTo || null },
        priority: { type: sql.NVarChar, value: priority || null },
        forceCloseReason: { type: sql.NVarChar(sql.MAX), value: forceCloseReason || null },
        adminId: { type: sql.UniqueIdentifier, value: req.user.id },
      }
    );

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'task_admin_updated',
      targetType: 'task',
      targetId: id,
      targetName: taskResult.recordset[0].title,
      metadata: { assignedTo, priority, forceCloseReason: !!forceCloseReason },
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'Task updated by admin.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed admin update.' });
  }
});

router.post('/:id/dependencies',
  validate([
    body('blockedBy').isArray().withMessage('blockedBy must be an array.'),
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { blockedBy } = req.body;
      const baseTask = await query(
        `SELECT id, project_id FROM tasks WHERE id = @id AND env_id = @envId`,
        {
          id: { type: sql.UniqueIdentifier, value: id },
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        }
      );
      if (!baseTask.recordset.length) return res.status(404).json({ success: false, message: 'Task not found.' });
      if (!baseTask.recordset[0].project_id) return res.status(400).json({ success: false, message: 'Dependencies require project tasks.' });

      const projectId = baseTask.recordset[0].project_id;
      await query(`DELETE FROM task_dependencies WHERE task_id = @taskId`, { taskId: { type: sql.UniqueIdentifier, value: id } });
      for (const dep of blockedBy) {
        await query(
          `INSERT INTO task_dependencies (id, env_id, project_id, task_id, depends_on_task_id)
           VALUES (NEWID(), @envId, @projectId, @taskId, @depId)`,
          {
            envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
            projectId: { type: sql.UniqueIdentifier, value: projectId },
            taskId: { type: sql.UniqueIdentifier, value: id },
            depId: { type: sql.UniqueIdentifier, value: dep },
          }
        );
      }
      res.json({ success: true, message: 'Dependencies updated.' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to update dependencies.' });
    }
  }
);

router.get('/project/:projectId/dependencies', async (req, res) => {
  try {
    const { projectId } = req.params;
    const tasks = await query(
      `SELECT t.id, t.title, t.status, t.assigned_to, u.full_name as assignee_name, u.team as assignee_team
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.project_id = @projectId AND t.env_id = @envId`,
      {
        projectId: { type: sql.UniqueIdentifier, value: projectId },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );
    const deps = await query(
      `SELECT task_id, depends_on_task_id
       FROM task_dependencies
       WHERE project_id = @projectId`,
      { projectId: { type: sql.UniqueIdentifier, value: projectId } }
    );
    res.json({ success: true, tasks: tasks.recordset, dependencies: deps.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load dependencies.' });
  }
});

router.get('/project/:projectId/accountability-chain', async (req, res) => {
  try {
    if (!isAdminRole(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    const { projectId } = req.params;
    const report = await query(
      `SELECT
         blocker.id as blocker_task_id,
         blocker.title as blocker_task_title,
         owner.full_name as blocker_owner,
         COUNT(td.id) as impacted_tasks,
         SUM(CASE
               WHEN blocker.due_date IS NOT NULL AND blocker.status != 'done' AND blocker.due_date < CAST(GETUTCDATE() AS DATE)
               THEN DATEDIFF(day, blocker.due_date, CAST(GETUTCDATE() AS DATE))
               ELSE 0
             END) as cumulative_delay_days
       FROM task_dependencies td
       JOIN tasks blocker ON blocker.id = td.depends_on_task_id
       LEFT JOIN users owner ON owner.id = blocker.assigned_to
       WHERE td.project_id = @projectId
       GROUP BY blocker.id, blocker.title, owner.full_name
       ORDER BY cumulative_delay_days DESC, impacted_tasks DESC`,
      { projectId: { type: sql.UniqueIdentifier, value: projectId } }
    );
    res.json({ success: true, chains: report.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to generate accountability chain report.' });
  }
});

module.exports = router;
