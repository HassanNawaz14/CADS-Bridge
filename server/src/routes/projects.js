const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { query, sql, transaction } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditLog } = require('../utils/auditLog');
const { notify } = require('../utils/notify');
const { logProjectChange } = require('../utils/projectHistory');

const ALLOWED_PROJECT_FEATURES = [
  'messaging',
  'file_sharing',
  'task_board',
  'kpi_command_centre',
  'annotations',
  'knowledge_hub',
  'reporting',
  'conflict_detection',
];

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
    body('domain').isIn(['finance', 'data', 'hybrid']).withMessage('Invalid domain selected.'),
    body('caMembers').isArray({ min: 1 }).withMessage('At least one CA member is required.'),
    body('caMembers.*').isUUID().withMessage('CA member IDs must be valid GUIDs.'),
    body('dsMembers').isArray({ min: 1 }).withMessage('At least one DS member is required.'),
    body('dsMembers.*').isUUID().withMessage('DS member IDs must be valid GUIDs.'),
    body('startDate').isISO8601().withMessage('Valid start date is required.'),
    body('endDate').isISO8601().withMessage('Valid end date is required.'),
    body('milestones').isArray({ min: 1 }).withMessage('At least one milestone is required.'),
    body('milestones.*.title').trim().notEmpty().withMessage('Each milestone needs a title.'),
    body('milestones.*.dueDate').isISO8601().withMessage('Each milestone needs a valid due date.'),
    body('features').isArray({ min: 1 }).withMessage('At least one workspace feature is required.'),
    body('features.*').isIn(ALLOWED_PROJECT_FEATURES).withMessage('Invalid project feature selected.'),
  ]),
  async (req, res) => {
    try {
      const { name, description, objectives, domain: frontendDomain, caMembers, dsMembers, startDate, endDate, milestones, features } = req.body;

      // Map frontend domain to backend domain
      const domainMap = { finance: 'CA', data: 'DS', hybrid: 'JOINT' };
      if (!domainMap[frontendDomain]) {
        return res.status(400).json({ success: false, message: 'Invalid project domain selected.' });
      }
      const domain = domainMap[frontendDomain];

      const projectStart = new Date(startDate);
      const projectEnd = new Date(endDate);
      if (projectEnd <= projectStart) {
        return res.status(400).json({ success: false, message: 'End date must be after start date.' });
      }

      const allMembers = [...new Set([...caMembers, ...dsMembers])];

      const memberCheck = await query(
        `SELECT id, team FROM users
         WHERE id IN (${allMembers.map((_, i) => `@m${i}`).join(',')})
           AND env_id = @envId
           AND status = 'active'`,
        {
          ...Object.fromEntries(allMembers.map((m, i) => [`m${i}`, { type: sql.UniqueIdentifier, value: m }])),
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        }
      );

      if (memberCheck.recordset.length !== allMembers.length) {
        return res.status(400).json({ success: false, message: 'One or more selected members are invalid or inactive.' });
      }

      const memberTeams = memberCheck.recordset.reduce((map, member) => {
        map[member.id] = member.team;
        return map;
      }, {});

      for (const memberId of caMembers) {
        if (memberTeams[memberId] !== 'CA') {
          return res.status(400).json({ success: false, message: 'All CA members must belong to the CA team.' });
        }
      }
      for (const memberId of dsMembers) {
        if (memberTeams[memberId] !== 'DS') {
          return res.status(400).json({ success: false, message: 'All DS members must belong to the DS team.' });
        }
      }

      const projectId = require('uuid').v4();

      await transaction(async (trx) => {
        const request = (params) => {
          const req = trx.request();
          Object.entries(params).forEach(([key, { type, value }]) => req.input(key, type, value));
          return req;
        };

        await request({
          id:     { type: sql.UniqueIdentifier, value: projectId },
          envId:  { type: sql.UniqueIdentifier, value: req.user.env_id },
          name:   { type: sql.NVarChar, value: name },
          desc:   { type: sql.NVarChar(sql.MAX), value: description },
          obj:    { type: sql.NVarChar(sql.MAX), value: objectives },
          domain: { type: sql.NVarChar, value: domain },
          by:     { type: sql.UniqueIdentifier, value: req.user.id },
          start:  { type: sql.Date, value: projectStart },
          end:    { type: sql.Date, value: projectEnd },
        }).query(
          `INSERT INTO projects (id, env_id, name, description, objectives, domain, initiated_by, start_date, end_date, status)
           VALUES (@id, @envId, @name, @desc, @obj, @domain, @by, @start, @end, 'pending')`
        );

        const membersToAdd = new Set([...allMembers, req.user.id]);
        for (const memberId of membersToAdd) {
          await request({
            pid: { type: sql.UniqueIdentifier, value: projectId },
            uid: { type: sql.UniqueIdentifier, value: memberId },
          }).query(
            `INSERT INTO project_members (id, project_id, user_id) VALUES (NEWID(), @pid, @uid)`
          );
        }

        for (const m of milestones) {
          const dueDate = new Date(m.dueDate);
          if (dueDate < projectStart || dueDate > projectEnd) {
            throw new Error('Milestone dates must be within the project timeline.');
          }
          await request({
            pid:   { type: sql.UniqueIdentifier, value: projectId },
            title: { type: sql.NVarChar, value: m.title.trim() },
            due:   { type: sql.Date, value: dueDate },
          }).query(
            `INSERT INTO project_milestones (id, project_id, title, due_date) VALUES (NEWID(), @pid, @title, @due)`
          );
        }

        for (const feature of features) {
          await request({
            pid:     { type: sql.UniqueIdentifier, value: projectId },
            feature: { type: sql.NVarChar, value: feature },
          }).query(
            `INSERT INTO project_features (id, project_id, feature) VALUES (NEWID(), @pid, @feature)`
          );
        }
      });

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

      await logProjectChange({
        projectId,
        changedBy: req.user.id,
        changeType: 'created',
        changeNote: `Project created with domain: ${domain}, ${caMembers.length} CA + ${dsMembers.length} DS members, ${milestones.length} milestones, features: ${features.join(', ')}`,
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
      console.error('Project creation failed:', err.stack || err);
      const isValidationError = err.message === 'Milestone dates must be within the project timeline.';
      const message = isValidationError ? err.message : 'Failed to create project.';
      res.status(isValidationError ? 400 : 500).json({ success: false, message });
    }
  }
);

// ── POST /api/projects/:id/approve ───────────────────────────────────────
router.post('/:id/approve', requireRole('admin', 'platform_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const projResult = await query(
      `SELECT p.id, p.name, p.status, p.domain, u.team as admin_team
       FROM projects p
       JOIN users u ON u.id = @adminId
       WHERE p.id = @id AND p.env_id = @envId`,
      {
        id:      { type: sql.UniqueIdentifier, value: id },
        adminId: { type: sql.UniqueIdentifier, value: req.user.id },
        envId:   { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );
    if (!projResult.recordset.length) return res.status(404).json({ success: false, message: 'Project not found.' });
    
    const project = projResult.recordset[0];
    if (project.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Project is not pending approval.' });
    }

    const adminTeam = project.admin_team;
    const requiresBothAdmins = project.domain === 'JOINT';

    if (!['CA', 'DS'].includes(adminTeam)) {
      return res.status(403).json({ success: false, message: 'Only CA or DS admins can approve projects.' });
    }

    if (project.domain === 'CA' && adminTeam !== 'CA') {
      return res.status(403).json({ success: false, message: 'Only CA admins can approve this project.' });
    }
    if (project.domain === 'DS' && adminTeam !== 'DS') {
      return res.status(403).json({ success: false, message: 'Only DS admins can approve this project.' });
    }

    await transaction(async (trx) => {
      const request = (params) => {
        const req = trx.request();
        Object.entries(params).forEach(([key, { type, value }]) => req.input(key, type, value));
        return req;
      };

      // Record this admin's approval
      await request({
        pid:   { type: sql.UniqueIdentifier, value: id },
        aid:   { type: sql.UniqueIdentifier, value: req.user.id },
        team:  { type: sql.NVarChar, value: adminTeam },
        notes: { type: sql.NVarChar(sql.MAX), value: notes || null },
      }).query(
        `INSERT INTO project_approvals (id, project_id, admin_id, admin_team, notes)
         VALUES (NEWID(), @pid, @aid, @team, @notes)`
      );

      // Check if all required approvals are complete
      let allApproved = false;
      if (requiresBothAdmins) {
        // For JOINT projects, need both CA and DS admin approval
        const approvalCount = await trx.request()
          .input('pid', sql.UniqueIdentifier, id)
          .query(`SELECT COUNT(*) as count FROM project_approvals WHERE project_id = @pid`);
        allApproved = approvalCount.recordset[0].count >= 2;
      } else {
        // For CA/DS-only projects, single admin approval is sufficient
        allApproved = true;
      }

      if (allApproved) {
        // Activate the project
        await request({
          id: { type: sql.UniqueIdentifier, value: id },
          by: { type: sql.UniqueIdentifier, value: req.user.id },
        }).query(
          `UPDATE projects SET status = 'active', approved_by = @by, approved_at = GETUTCDATE(), updated_at = GETUTCDATE()
           WHERE id = @id`
        );

        // Notify all project members
        const members = await trx.request()
          .input('id', sql.UniqueIdentifier, id)
          .query(`SELECT user_id FROM project_members WHERE project_id = @id AND is_active = 1`);
        for (const m of members.recordset) {
          await notify({
            userId: m.user_id,
            type: 'project_approved',
            title: 'Project Approved',
            body: `Your project "${project.name}" has been approved! The shared workspace is now active.`,
            refId: id,
            io: req.app.get('io'),
          });
        }
      }
    });

    // Log approval in history
    await logProjectChange({
      projectId: id,
      changedBy: req.user.id,
      changeType: 'approved',
      fieldName: 'status',
      oldValue: 'pending',
      newValue: requiresBothAdmins ? 'pending' : 'active', // Will be 'active' if single approval sufficient
      changeNote: notes || `Approved by ${adminTeam} admin`,
    });

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'project_approved',
      targetType: 'project',
      targetId: id,
      targetName: project.name,
      ipAddress: req.ip,
    });

    const message = requiresBothAdmins 
      ? 'Your approval has been recorded. Waiting for the other admin team to approve.'
      : 'Project approved and workspace activated.';

    res.json({ success: true, message });
  } catch (err) {
    console.error('Project approval failed:', err);
    const duplicateApproval = err.number === 2627 || err.number === 2601 || err.message?.includes('UNIQUE constraint');
    if (duplicateApproval) {
      return res.status(400).json({ success: false, message: 'You have already approved this project.' });
    }
    res.status(500).json({ success: false, message: 'Failed to approve project.' });
  }
});

// ── POST /api/projects/:id/request-changes ──────────────────────────────
router.post('/:id/request-changes', requireRole('admin', 'platform_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'Change request reason is required.' });
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
      `UPDATE projects SET status = 'draft', rejection_note = @reason, updated_at = GETUTCDATE() WHERE id = @id`,
      {
        id:     { type: sql.UniqueIdentifier, value: id },
        reason: { type: sql.NVarChar(sql.MAX), value: reason },
      }
    );

    await notify({
      userId: projResult.recordset[0].initiated_by,
      type: 'project_changes_requested',
      title: 'Project Changes Requested',
      body: `Changes requested for your project "${projResult.recordset[0].name}". Please review and resubmit.`,
      refId: id,
      io: req.app.get('io'),
    });

    // Log change request in history
    await logProjectChange({
      projectId: id,
      changedBy: req.user.id,
      changeType: 'changes_requested',
      fieldName: 'status',
      oldValue: 'pending',
      newValue: 'draft',
      changeNote: reason,
    });

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'project_changes_requested',
      targetType: 'project',
      targetId: id,
      targetName: projResult.recordset[0].name,
      metadata: { reason },
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'Changes requested. Project returned to draft status.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to request changes.' });
  }
});

// ── POST /api/projects/:id/reject ────────────────────────────────────────
router.post('/:id/reject', requireRole('admin', 'platform_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason?.trim() || reason.trim().length < 20) {
      return res.status(400).json({ success: false, message: 'Rejection reason must be at least 20 characters.' });
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

// ── POST /api/projects/:id/complete ──────────────────────────────────────
router.post('/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user is a project member
    const memberCheck = await query(
      `SELECT pm.id FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       WHERE pm.project_id = @id AND pm.user_id = @uid AND pm.is_active = 1 AND p.env_id = @envId`,
      {
        id:    { type: sql.UniqueIdentifier, value: id },
        uid:   { type: sql.UniqueIdentifier, value: req.user.id },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );
    if (!memberCheck.recordset.length) {
      return res.status(403).json({ success: false, message: 'You do not have access to this project.' });
    }

    const projResult = await query(
      `SELECT id, name, status FROM projects WHERE id = @id AND env_id = @envId`,
      {
        id:    { type: sql.UniqueIdentifier, value: id },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );
    if (!projResult.recordset.length) return res.status(404).json({ success: false, message: 'Project not found.' });

    const project = projResult.recordset[0];
    if (project.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Only active projects can be completed.' });
    }

    // Check for unresolved critical annotations
    const unresolvedCritical = await query(
      `SELECT COUNT(*) as count FROM document_annotations da
       JOIN project_files pf ON pf.id = da.document_id
       WHERE da.project_id = @projectId AND da.status = 'OPEN'
         AND da.type IN ('FINANCIAL_CONSTRAINT', 'REGULATORY_FLAG')`,
      { projectId: { type: sql.UniqueIdentifier, value: id } }
    );
    if (unresolvedCritical.recordset[0].count > 0) {
      return res.status(400).json({ success: false, message: 'Cannot complete project with unresolved critical annotations.' });
    }

    // Gate rule: unresolved compliance breaches block completion
    const unresolvedBreaches = await query(
      `SELECT COUNT(*) as count
       FROM constraint_breach_logs
       WHERE env_id = @envId AND project_id = @projectId AND status != 'RESOLVED'`,
      {
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        projectId: { type: sql.UniqueIdentifier, value: id },
      }
    );
    if (unresolvedBreaches.recordset[0].count > 0) {
      return res.status(400).json({ success: false, message: 'Cannot complete project with unresolved compliance breaches.' });
    }

    // Generate decision rationale document
    const annotations = await query(
      `SELECT da.id, da.document_id, da.selected_text, da.type, da.body, da.status,
              da.resolved_at, da.created_at,
              pf.original_name as document_name,
              u.full_name as author_name,
              ru.full_name as resolver_name,
              ar.reply_text, ar.created_at as reply_created_at, aru.full_name as reply_author_name
       FROM document_annotations da
       JOIN project_files pf ON pf.id = da.document_id
       LEFT JOIN users u ON u.id = da.author_id
       LEFT JOIN users ru ON ru.id = da.resolved_by
       LEFT JOIN annotation_replies ar ON ar.annotation_id = da.id
       LEFT JOIN users aru ON aru.id = ar.author_id
       WHERE da.project_id = @projectId
       ORDER BY da.created_at ASC, ar.created_at ASC`,
      { projectId: { type: sql.UniqueIdentifier, value: id } }
    );

    // Generate HTML document
    let html = `<html><head><title>Decision Rationale - ${project.name}</title></head><body>`;
    html += `<h1>Decision Rationale Document</h1>`;
    html += `<p>Project: ${project.name}</p>`;
    html += `<p>Generated: ${new Date().toISOString()}</p>`;
    html += `<h2>Annotations Summary</h2>`;

    const docs = {};
    annotations.recordset.forEach(row => {
      if (!docs[row.document_name]) docs[row.document_name] = [];
      if (!docs[row.document_name].find(a => a.id === row.id)) {
        docs[row.document_name].push({
          id: row.id,
          selected_text: row.selected_text,
          type: row.type,
          body: row.body,
          status: row.status,
          resolved_at: row.resolved_at,
          created_at: row.created_at,
          author_name: row.author_name,
          resolver_name: row.resolver_name,
          replies: [],
        });
      }
      if (row.reply_text) {
        const ann = docs[row.document_name].find(a => a.id === row.id);
        ann.replies.push({
          text: row.reply_text,
          created_at: row.reply_created_at,
          author_name: row.reply_author_name,
        });
      }
    });

    Object.keys(docs).forEach(docName => {
      html += `<h3>${docName}</h3>`;
      docs[docName].forEach(ann => {
        html += `<div style="border:1px solid #ccc; margin:10px; padding:10px;">`;
        html += `<strong>${ann.type}</strong> - ${ann.status}<br>`;
        html += `Author: ${ann.author_name} | Created: ${ann.created_at}<br>`;
        if (ann.resolver_name) html += `Resolved by: ${ann.resolver_name} | Resolved: ${ann.resolved_at}<br>`;
        if (ann.selected_text) html += `<em>"${ann.selected_text}"</em><br>`;
        html += `${ann.body}<br>`;
        if (ann.replies.length > 0) {
          html += `<strong>Replies:</strong><ul>`;
          ann.replies.forEach(reply => {
            html += `<li>${reply.author_name}: ${reply.text} (${reply.created_at})</li>`;
          });
          html += `</ul>`;
        }
        html += `</div>`;
      });
    });

    html += `</body></html>`;

    // Save the document
    const fs = require('fs').promises;
    const path = require('path');
    const uploadsDir = path.join(__dirname, '../../uploads');
    const fileName = `decision_rationale_${id}_${Date.now()}.html`;
    const filePath = path.join(uploadsDir, fileName);
    await fs.writeFile(filePath, html);

    // Insert into database
    await query(
      `INSERT INTO decision_rationale_documents (id, project_id, document_path, generated_at)
       VALUES (NEWID(), @projectId, @filePath, GETUTCDATE())`,
      {
        projectId: { type: sql.UniqueIdentifier, value: id },
        filePath: { type: sql.NVarChar, value: fileName },
      }
    );

    // Update project status
    await query(
      `UPDATE projects SET status = 'completed', updated_at = GETUTCDATE() WHERE id = @id`,
      { id: { type: sql.UniqueIdentifier, value: id } }
    );

    // Prompt admins to publish deliverables to Knowledge Hub (Feature 3.6.2)
    const admins = await query(
      `SELECT id FROM users
       WHERE env_id = @envId AND role IN ('admin','platform_admin','super_admin') AND status = 'active'`,
      { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
    );
    for (const admin of admins.recordset) {
      await notify({
        userId: admin.id,
        type: 'knowledge_hub_publish_prompt',
        title: 'Publish to Knowledge Hub?',
        body: `Project "${project.name}" is completed. Review and publish relevant deliverables to the Knowledge Hub.`,
        refId: id,
        io: req.app.get('io'),
      });
    }

    // Log completion
    await logProjectChange({
      projectId: id,
      changedBy: req.user.id,
      changeType: 'completed',
      fieldName: 'status',
      oldValue: 'active',
      newValue: 'completed',
      changeNote: 'Project completed with decision rationale document generated',
    });

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'project_completed',
      targetType: 'project',
      targetId: id,
      targetName: project.name,
      metadata: { rationaleDocument: fileName },
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'Project completed successfully. Decision rationale document generated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to complete project.' });
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
