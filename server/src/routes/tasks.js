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
      `SELECT t.id, t.title, t.description, t.priority, t.status, t.due_date, t.created_at, t.completed_at,
              cb.full_name as created_by_name, cb.team as created_by_team,
              ab.full_name as assigned_to_name, ab.team as assigned_to_team, ab.avatar_initials
       FROM tasks t
       JOIN users cb ON cb.id = t.created_by
       LEFT JOIN users ab ON ab.id = t.assigned_to
       ${whereClause}
       ORDER BY
         CASE t.priority WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
         t.due_date ASC, t.created_at DESC`,
      params
    );
    res.json({ success: true, tasks: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch tasks.' });
  }
});

// ── POST /api/tasks ───────────────────────────────────────────────────────
router.post('/',
  validate([
    body('title').trim().isLength({ min: 3, max: 200 }).withMessage('Task title must be 3–200 characters.'),
    body('priority').isIn(['High', 'Medium', 'Low']).withMessage('Priority must be High, Medium, or Low.'),
    body('dueDate').optional().isDate().withMessage('Valid due date is required.'),
  ]),
  async (req, res) => {
    try {
      const { title, description, priority, dueDate, assignedTo, projectId } = req.body;

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

      const result = await query(
        `INSERT INTO tasks (id, project_id, env_id, title, description, priority, status, assigned_to, created_by, due_date)
         OUTPUT INSERTED.*
         VALUES (NEWID(), @pid, @envId, @title, @desc, @priority, 'todo', @assignedTo, @createdBy, @dueDate)`,
        {
          pid:       { type: sql.UniqueIdentifier, value: projectId || null },
          envId:     { type: sql.UniqueIdentifier, value: req.user.env_id },
          title:     { type: sql.NVarChar, value: title },
          desc:      { type: sql.NVarChar(sql.MAX), value: description || null },
          priority:  { type: sql.NVarChar, value: priority },
          assignedTo:{ type: sql.UniqueIdentifier, value: assignedTo || null },
          createdBy: { type: sql.UniqueIdentifier, value: req.user.id },
          dueDate:   { type: sql.Date, value: dueDate ? new Date(dueDate) : null },
        }
      );

      const task = result.recordset[0];

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
        metadata: { priority, assignedTo },
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
    body('status').isIn(['todo', 'in_progress', 'done']).withMessage('Invalid status.'),
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

      res.json({ success: true, message: `Task moved to ${status}.` });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to update task status.' });
    }
  }
);

module.exports = router;
