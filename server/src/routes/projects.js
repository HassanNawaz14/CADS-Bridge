const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { query, sql, transaction } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditLog } = require('../utils/auditLog');
const { notify } = require('../utils/notify');
const { logProjectChange } = require('../utils/projectHistory');

const validate = (vs) => async (req, res, next) => {
  await Promise.all(vs.map((v) => v.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
};

router.use(authenticate);

// ── GET /api/projects/team/users ──────────────────────────────────────────
// Public endpoint for authenticated users to fetch active team members (for project creation)
router.get('/team/users', async (req, res) => {
  try {
    const { status, team, search } = req.query;
    let whereClause = 'WHERE u.env_id = @envId AND u.status = @status';
    const params = {
      envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      status: { type: sql.NVarChar, value: status || 'active' },
    };

    if (team) {
      whereClause += ' AND u.team = @team';
      params.team = { type: sql.NVarChar, value: team };
    }
    if (search) {
      whereClause += ' AND (u.full_name LIKE @search OR u.email LIKE @search)';
      params.search = { type: sql.NVarChar, value: `%${search}%` };
    }

    const result = await query(
      `SELECT u.id, u.full_name, u.email, u.team, u.designation, u.avatar_initials
       FROM users u
       ${whereClause}
       AND u.role != 'platform_admin'
       ORDER BY u.full_name ASC`,
      params
    );
    res.json({ success: true, users: result.recordset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch team members.' });
  }
});

// ── GET /api/projects ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;

    // Members only see projects they're part of; admins see all
    let baseQuery;
    const params = { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } };

    if (['admin', 'platform_admin'].includes(req.user.role)) {
      baseQuery = `
        SELECT p.id, p.name, p.description, p.status, p.start_date, p.end_date, p.created_at,
               u.full_name as initiated_by_name, u.team as initiated_by_team
        FROM projects p
        JOIN users u ON u.id = p.initiated_by
        WHERE p.env_id = @envId
        ${status ? 'AND p.status = @status' : ''}
        ORDER BY p.created_at DESC`;
    } else {
      baseQuery = `
        SELECT p.id, p.name, p.description, p.status, p.start_date, p.end_date, p.created_at,
               u.full_name as initiated_by_name, u.team as initiated_by_team
        FROM projects p
        JOIN users u ON u.id = p.initiated_by
        JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = @userId AND pm.is_active = 1
        WHERE p.env_id = @envId
        ${status ? 'AND p.status = @status' : ''}
        ORDER BY p.created_at DESC`;
      params.userId = { type: sql.UniqueIdentifier, value: req.user.id };
    }

    if (status) params.status = { type: sql.NVarChar, value: status };

    const result = await query(baseQuery, params);
    res.json({ success: true, projects: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch projects.' });
  }
});

// ── GET /api/projects/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT p.*, u.full_name as initiated_by_name, u.team as initiated_by_team
       FROM projects p
       JOIN users u ON u.id = p.initiated_by
       WHERE p.id = @id AND p.env_id = @envId`,
      {
        id:    { type: sql.UniqueIdentifier, value: id },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );
    if (!result.recordset.length) return res.status(404).json({ success: false, message: 'Project not found.' });

    const project = result.recordset[0];

    // Fetch members
    const members = await query(
      `SELECT u.id, u.full_name, u.team, u.designation, u.avatar_initials, pm.added_at
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = @id AND pm.is_active = 1`,
      { id: { type: sql.UniqueIdentifier, value: id } }
    );

    // Fetch milestones
    const milestones = await query(
      `SELECT * FROM project_milestones WHERE project_id = @id ORDER BY due_date ASC`,
      { id: { type: sql.UniqueIdentifier, value: id } }
    );

    // Fetch features
    const features = await query(
      `SELECT feature FROM project_features WHERE project_id = @id`,
      { id: { type: sql.UniqueIdentifier, value: id } }
    );

    res.json({
      success: true,
      project: {
        ...project,
        members: members.recordset,
        milestones: milestones.recordset,
        features: features.recordset.map((f) => f.feature),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch project.' });
  }
});

// ── POST /api/projects ────────────────────────────────────────────────────
router.post('/',
  validate([
    body('name').trim().isLength({ min: 3, max: 200 }).withMessage('Project name must be 3–200 characters.'),
    body('description').trim().notEmpty().withMessage('Description is required.'),
    body('objectives').trim().notEmpty().withMessage('Objectives are required.'),
    body('caMembers').isArray({ min: 1 }).withMessage('At least one CA member required.'),
    body('dsMembers').isArray({ min: 1 }).withMessage('At least one DS member required.'),
    body('startDate').isDate().withMessage('Valid start date is required.'),
    body('endDate').isDate().withMessage('Valid end date is required.'),
    body('milestones').isArray({ min: 1 }).withMessage('At least one milestone is required.'),
    body('features').isArray({ min: 1 }).withMessage('At least one workspace feature is required.'),
  ]),
  async (req, res) => {
    try {
      const { name, description, objectives, caMembers, dsMembers, startDate, endDate, milestones, features } = req.body;

      if (new Date(endDate) <= new Date(startDate)) {
        return res.status(400).json({ success: false, message: 'End date must be after start date.' });
      }

      // Combine CA and DS members
      const allMembers = [...new Set([...caMembers, ...dsMembers])];

      // Verify members belong to this env and have correct teams
      const memberCheck = await query(
        `SELECT id, team FROM users
         WHERE id IN (${allMembers.map((_, i) => `@m${i}`).join(',')}) AND env_id = @envId AND status = 'active'`,
        {
          ...Object.fromEntries(allMembers.map((m, i) => [`m${i}`, { type: sql.UniqueIdentifier, value: m }])),
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        }
      );
      if (memberCheck.recordset.length !== allMembers.length) {
        return res.status(400).json({ success: false, message: 'One or more selected members are invalid.' });
      }

      // Verify CA members are actually CA and DS members are actually DS
      const caTeams = new Set(memberCheck.recordset.filter(m => caMembers.includes(m.id)).map(m => m.team));
      const dsTeams = new Set(memberCheck.recordset.filter(m => dsMembers.includes(m.id)).map(m => m.team));

      if (!caTeams.has('CA')) {
        return res.status(400).json({ success: false, message: 'Selected CA members must be from the CA team.' });
      }
      if (!dsTeams.has('DS')) {
        return res.status(400).json({ success: false, message: 'Selected DS members must be from the DS team.' });
      }

      // Create project + members + milestones + features
      const projectId = require('uuid').v4();

      await query(
        `INSERT INTO projects (id, env_id, name, description, objectives, initiated_by, start_date, end_date, status)
         VALUES (@id, @envId, @name, @desc, @obj, @by, @start, @end, 'pending')`,
        {
          id:    { type: sql.UniqueIdentifier, value: projectId },
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          name:  { type: sql.NVarChar, value: name },
          desc:  { type: sql.NVarChar(sql.MAX), value: description },
          obj:   { type: sql.NVarChar(sql.MAX), value: objectives },
          by:    { type: sql.UniqueIdentifier, value: req.user.id },
          start: { type: sql.Date, value: new Date(startDate) },
          end:   { type: sql.Date, value: new Date(endDate) },
        }
      );

      // Add members (including initiator if not included)
      const membersToAdd = new Set([...allMembers, req.user.id]);
      for (const memberId of membersToAdd) {
        await query(
          `INSERT INTO project_members (id, project_id, user_id) VALUES (NEWID(), @pid, @uid)`,
          {
            pid: { type: sql.UniqueIdentifier, value: projectId },
            uid: { type: sql.UniqueIdentifier, value: memberId },
          }
        );
      }

      // Add milestones
      for (const m of milestones) {
        await query(
          `INSERT INTO project_milestones (id, project_id, title, due_date) VALUES (NEWID(), @pid, @title, @due)`,
          {
            pid:   { type: sql.UniqueIdentifier, value: projectId },
            title: { type: sql.NVarChar, value: m.title },
            due:   { type: sql.Date, value: new Date(m.dueDate) },
          }
        );
      }

      // Add features
      for (const feature of features) {
        await query(
          `INSERT INTO project_features (id, project_id, feature) VALUES (NEWID(), @pid, @feature)`,
          {
            pid:     { type: sql.UniqueIdentifier, value: projectId },
            feature: { type: sql.NVarChar, value: feature },
          }
        );
      }

      // Notify admins
      const admins = await query(
        `SELECT id FROM users WHERE env_id = @envId AND role IN ('admin','platform_admin') AND status = 'active'`,
        { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
      );
      for (const admin of admins.recordset) {
        await notify({
          userId: admin.id,
          type: 'project_pending',
          title: 'New Project Proposal',
          body: `${req.user.full_name} submitted a new project: "${name}" for approval.`,
          refId: projectId,
          io: req.app.get('io'),
        });
      }

      // Log project creation in history
      await logProjectChange({
        projectId,
        changedBy: req.user.id,
        changeType: 'created',
        changeNote: `Project created with ${caMembers.length} CA + ${dsMembers.length} DS members, ${milestones.length} milestones, features: ${features.join(', ')}`,
      });

      await auditLog({
        envId: req.user.env_id,
        actorId: req.user.id,
        actionType: 'project_created',
        targetType: 'project',
        targetId: projectId,
        targetName: name,
        ipAddress: req.ip,
      });

      res.status(201).json({ success: true, message: 'Project proposal submitted for admin approval.', projectId });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Failed to create project.' });
    }
  }
);

// ── POST /api/projects/:id/approve ───────────────────────────────────────
router.post('/:id/approve', requireRole('admin', 'platform_admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const projResult = await query(
      `SELECT id, name, status FROM projects WHERE id = @id AND env_id = @envId`,
      {
        id:    { type: sql.UniqueIdentifier, value: id },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );
    if (!projResult.recordset.length) return res.status(404).json({ success: false, message: 'Project not found.' });
    if (projResult.recordset[0].status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Project is not pending approval.' });
    }

    await query(
      `UPDATE projects SET status = 'active', approved_by = @by, approved_at = GETUTCDATE(), updated_at = GETUTCDATE()
       WHERE id = @id`,
      {
        id: { type: sql.UniqueIdentifier, value: id },
        by: { type: sql.UniqueIdentifier, value: req.user.id },
      }
    );

    // Notify all project members
    const members = await query(
      `SELECT user_id FROM project_members WHERE project_id = @id AND is_active = 1`,
      { id: { type: sql.UniqueIdentifier, value: id } }
    );
    for (const m of members.recordset) {
      await notify({
        userId: m.user_id,
        type: 'project_approved',
        title: 'Project Approved',
        body: `Your project "${projResult.recordset[0].name}" has been approved! The shared workspace is now active.`,
        refId: id,
        io: req.app.get('io'),
      });
    }

    // Log approval in history
    await logProjectChange({
      projectId: id,
      changedBy: req.user.id,
      changeType: 'approved',
      fieldName: 'status',
      oldValue: 'pending',
      newValue: 'active',
    });

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'project_approved',
      targetType: 'project',
      targetId: id,
      targetName: projResult.recordset[0].name,
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'Project approved and workspace activated.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to approve project.' });
  }
});

// ── POST /api/projects/:id/reject ────────────────────────────────────────
router.post('/:id/reject', requireRole('admin', 'platform_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
    }

    const projResult = await query(
      `SELECT id, name, initiated_by FROM projects WHERE id = @id AND env_id = @envId AND status = 'pending'`,
      {
        id:    { type: sql.UniqueIdentifier, value: id },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );
    if (!projResult.recordset.length) return res.status(404).json({ success: false, message: 'Pending project not found.' });

    await query(
      `UPDATE projects SET status = 'rejected', rejection_note = @reason, updated_at = GETUTCDATE() WHERE id = @id`,
      {
        id:     { type: sql.UniqueIdentifier, value: id },
        reason: { type: sql.NVarChar(sql.MAX), value: reason },
      }
    );

    await notify({
      userId: projResult.recordset[0].initiated_by,
      type: 'project_rejected',
      title: 'Project Rejected',
      body: `Your project "${projResult.recordset[0].name}" was not approved. Reason: ${reason}`,
      refId: id,
      io: req.app.get('io'),
    });

    // Log rejection in history
    await logProjectChange({
      projectId: id,
      changedBy: req.user.id,
      changeType: 'rejected',
      fieldName: 'status',
      oldValue: 'pending',
      newValue: 'rejected',
      changeNote: reason,
    });

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'project_rejected',
      targetType: 'project',
      targetId: id,
      targetName: projResult.recordset[0].name,
      metadata: { reason },
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'Project rejected.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reject project.' });
  }
});

// ── GET /api/projects/:id/history ──────────────────────────────────────
router.get('/:id/history', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user has access to this project
    const accessCheck = await query(
      `SELECT pm.id FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       WHERE pm.project_id = @id AND pm.user_id = @uid AND pm.is_active = 1 AND p.env_id = @envId`,
      {
        id:    { type: sql.UniqueIdentifier, value: id },
        uid:   { type: sql.UniqueIdentifier, value: req.user.id },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );
    if (!accessCheck.recordset.length && !['admin', 'platform_admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const history = await query(
      `SELECT ph.change_type, ph.field_name, ph.old_value, ph.new_value, ph.change_note, ph.changed_at,
              u.full_name as changed_by_name, u.team as changed_by_team
       FROM project_history ph
       LEFT JOIN users u ON u.id = ph.changed_by
       WHERE ph.project_id = @id
       ORDER BY ph.changed_at DESC`,
      { id: { type: sql.UniqueIdentifier, value: id } }
    );

    res.json({ success: true, history: history.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch project history.' });
  }
});

module.exports = router;
