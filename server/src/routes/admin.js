const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, query: qv, param, validationResult } = require('express-validator');
const { query, sql } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditLog } = require('../utils/auditLog');
const { notify } = require('../utils/notify');

const validate = (vs) => async (req, res, next) => {
  await Promise.all(vs.map((v) => v.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
};

// All admin routes require auth + admin role
router.use(authenticate, requireRole('admin', 'platform_admin', 'super_admin'));

// ── GET /api/admin/users/pending ─────────────────────────────────────────
router.get('/users/pending', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, full_name, email, team, designation, created_at
       FROM users
       WHERE env_id = @envId AND status = 'pending'
       ORDER BY created_at ASC`,
      { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
    );
    res.json({ success: true, users: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch pending users.' });
  }
});

// ── GET /api/admin/users ─────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const { status, team, search } = req.query;
    let whereClause = 'WHERE u.env_id = @envId';
    const params = { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } };

    if (status) {
      whereClause += ' AND u.status = @status';
      params.status = { type: sql.NVarChar, value: status };
    }
    if (team) {
      whereClause += ' AND u.team = @team';
      params.team = { type: sql.NVarChar, value: team };
    }
    if (search) {
      whereClause += ' AND (u.full_name LIKE @search OR u.email LIKE @search)';
      params.search = { type: sql.NVarChar, value: `%${search}%` };
    }

    const result = await query(
      `SELECT u.id, u.full_name, u.email, u.team, u.role, u.status,
              u.designation, u.avatar_initials, u.last_login_at, u.created_at
       FROM users u
       ${whereClause}
       AND u.role != 'platform_admin'
       ORDER BY u.created_at DESC`,
      params
    );
    res.json({ success: true, users: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
});

// ── POST /api/admin/users/:userId/approve ────────────────────────────────
router.post('/users/:userId/approve', async (req, res) => {
  try {
    const { userId } = req.params;

    const userResult = await query(
      `SELECT id, full_name, email, env_id, status FROM users WHERE id = @id AND env_id = @envId`,
      {
        id:    { type: sql.UniqueIdentifier, value: userId },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );
    if (!userResult.recordset.length) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const user = userResult.recordset[0];
    if (user.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'User is not in pending status.' });
    }

    await query(
      `UPDATE users SET status = 'active', updated_at = GETUTCDATE() WHERE id = @id`,
      { id: { type: sql.UniqueIdentifier, value: userId } }
    );

    await notify({
      userId,
      type: 'access_approved',
      title: 'Access Request Approved',
      body: 'Your CADS-Bridge access request has been approved. You can now log in.',
      io: req.app.get('io'),
    });

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'user_approved',
      targetType: 'user',
      targetId: userId,
      targetName: user.full_name,
      ipAddress: req.ip,
    });

    res.json({ success: true, message: `${user.full_name}'s account has been activated.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to approve user.' });
  }
});

// ── POST /api/admin/users/:userId/reject ─────────────────────────────────
router.post('/users/:userId/reject', async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    const userResult = await query(
      `SELECT id, full_name FROM users WHERE id = @id AND env_id = @envId AND status = 'pending'`,
      {
        id:    { type: sql.UniqueIdentifier, value: userId },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );
    if (!userResult.recordset.length) {
      return res.status(404).json({ success: false, message: 'Pending user not found.' });
    }
    const user = userResult.recordset[0];

    await query(
      `UPDATE users SET status = 'rejected', updated_at = GETUTCDATE() WHERE id = @id`,
      { id: { type: sql.UniqueIdentifier, value: userId } }
    );

    await notify({
      userId,
      type: 'access_rejected',
      title: 'Access Request Rejected',
      body: reason || 'Your access request was reviewed and rejected. Please contact your administrator.',
      io: req.app.get('io'),
    });

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'user_rejected',
      targetType: 'user',
      targetId: userId,
      targetName: user.full_name,
      metadata: { reason },
      ipAddress: req.ip,
    });

    res.json({ success: true, message: `${user.full_name}'s request has been rejected.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reject user.' });
  }
});

// ── POST /api/admin/users/:userId/deactivate ─────────────────────────────
router.post('/users/:userId/deactivate', async (req, res) => {
  try {
    const { userId } = req.params;

    // Cannot deactivate yourself
    if (userId === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
    }

    // Cannot remove the last admin
    const adminCount = await query(
      `SELECT COUNT(*) as cnt FROM users
       WHERE env_id = @envId AND role = 'admin' AND status = 'active' AND id != @userId`,
      {
        envId:  { type: sql.UniqueIdentifier, value: req.user.env_id },
        userId: { type: sql.UniqueIdentifier, value: userId },
      }
    );
    const targetResult = await query(
      `SELECT id, full_name, role FROM users WHERE id = @id AND env_id = @envId`,
      {
        id:    { type: sql.UniqueIdentifier, value: userId },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );
    if (!targetResult.recordset.length) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const target = targetResult.recordset[0];

    if (target.role === 'admin' && adminCount.recordset[0].cnt === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one admin account must remain active.',
      });
    }

    await query(
      `UPDATE users SET status = 'deactivated', updated_at = GETUTCDATE() WHERE id = @id`,
      { id: { type: sql.UniqueIdentifier, value: userId } }
    );

    // Invalidate all sessions
    await query(
      `DELETE FROM refresh_tokens WHERE user_id = @userId`,
      { userId: { type: sql.UniqueIdentifier, value: userId } }
    );

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'user_deactivated',
      targetType: 'user',
      targetId: userId,
      targetName: target.full_name,
      ipAddress: req.ip,
    });

    res.json({ success: true, message: `${target.full_name}'s account has been deactivated.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to deactivate user.' });
  }
});

// ── POST /api/admin/users (create team admin) ────────────────────────────
router.post('/users',
  validate([
    body('fullName').trim().isLength({ min: 2 }).withMessage('Full name is required.'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required.'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('team').isIn(['CA', 'DS', 'NA']).withMessage('Team must be CA, DS, or NA.'),
    body('designation').trim().notEmpty().withMessage('Designation is required.'),
  ]),
  async (req, res) => {
    try {
      const { fullName, email, password, team, designation } = req.body;

      // Only platform_admin or super_admin can create super_admins
      if (team === 'NA' && req.user.role !== 'platform_admin' && req.user.role !== 'super_admin') {
        return res.status(403).json({ success: false, message: 'Only super admins can create super admins.' });
      }

      // Only platform_admin, super_admin, or admin can create team admins
      if (req.user.role !== 'platform_admin' && req.user.role !== 'super_admin' && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
      }

      const dupCheck = await query(
        `SELECT id FROM users WHERE env_id = @envId AND email = @email`,
        {
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          email: { type: sql.NVarChar, value: email },
        }
      );
      if (dupCheck.recordset.length) {
        return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
      }

      const hash = await bcrypt.hash(password, 10);
      const initials = fullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 4);
      const role = team === 'NA' ? 'super_admin' : 'admin';

      const result = await query(
        `INSERT INTO users (id, env_id, full_name, email, password_hash, designation, team, role, status, avatar_initials)
         OUTPUT INSERTED.id, INSERTED.full_name, INSERTED.email, INSERTED.team, INSERTED.role
         VALUES (NEWID(), @envId, @name, @email, @hash, @desig, @team, @role, 'active', @initials)`,
        {
          envId:    { type: sql.UniqueIdentifier, value: req.user.env_id },
          name:     { type: sql.NVarChar, value: fullName },
          email:    { type: sql.NVarChar, value: email },
          hash:     { type: sql.NVarChar, value: hash },
          desig:    { type: sql.NVarChar, value: designation },
          team:     { type: sql.NVarChar, value: team },
          role:     { type: sql.NVarChar, value: role },
          initials: { type: sql.NVarChar, value: initials },
        }
      );

      const newAdmin = result.recordset[0];

      await auditLog({
        envId: req.user.env_id,
        actorId: req.user.id,
        actionType: 'admin_created',
        targetType: 'user',
        targetId: newAdmin.id,
        targetName: fullName,
        metadata: { team, role: 'admin' },
        ipAddress: req.ip,
      });

      res.status(201).json({ success: true, message: 'Admin account created.', user: newAdmin });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to create admin account.' });
    }
  }
);

// ── GET /api/admin/audit-logs ────────────────────────────────────────────
router.get('/audit-logs', async (req, res) => {
  try {
    const { userId, actionType, dateFrom, dateTo, projectId, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE al.env_id = @envId';
    const params = { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } };

    if (userId) {
      whereClause += ' AND al.actor_id = @userId';
      params.userId = { type: sql.UniqueIdentifier, value: userId };
    }
    if (actionType) {
      whereClause += ' AND al.action_type = @actionType';
      params.actionType = { type: sql.NVarChar, value: actionType };
    }
    if (dateFrom) {
      whereClause += ' AND al.created_at >= @dateFrom';
      params.dateFrom = { type: sql.DateTime2, value: new Date(dateFrom) };
    }
    if (dateTo) {
      whereClause += ' AND al.created_at <= @dateTo';
      params.dateTo = { type: sql.DateTime2, value: new Date(dateTo) };
    }

    const result = await query(
      `SELECT al.id, al.action_type, al.target_type, al.target_id, al.target_name,
              al.metadata, al.ip_address, al.created_at,
              u.full_name as actor_name, u.team as actor_team, u.avatar_initials
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       ${whereClause}
       ORDER BY al.created_at DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      {
        ...params,
        offset: { type: sql.Int, value: offset },
        limit:  { type: sql.Int, value: parseInt(limit) },
      }
    );

    // Total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM audit_logs al ${whereClause}`,
      params
    );

    res.json({
      success: true,
      logs: result.recordset,
      pagination: {
        total: countResult.recordset[0].total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(countResult.recordset[0].total / parseInt(limit)),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch audit logs.' });
  }
});

// ── GET/PUT /api/admin/kpi-thresholds ────────────────────────────────────
router.get('/kpi-thresholds', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, metric_key, min_value, team, updated_at FROM kpi_thresholds WHERE env_id = @envId`,
      { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
    );
    res.json({ success: true, thresholds: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch thresholds.' });
  }
});

router.put('/kpi-thresholds/:metricKey', async (req, res) => {
  try {
    const { metricKey } = req.params;
    const { minValue, team } = req.body;

    await query(
      `UPDATE kpi_thresholds
       SET min_value = @val, updated_by = @by, updated_at = GETUTCDATE()
       WHERE env_id = @envId AND metric_key = @key AND team = @team`,
      {
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        key:   { type: sql.NVarChar, value: metricKey },
        val:   { type: sql.Decimal(10,4), value: parseFloat(minValue) },
        team:  { type: sql.NVarChar, value: team },
        by:    { type: sql.UniqueIdentifier, value: req.user.id },
      }
    );

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'kpi_threshold_updated',
      targetType: 'kpi_threshold',
      targetName: metricKey,
      metadata: { minValue, team },
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'Threshold updated.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update threshold.' });
  }
});

// ── Regulatory rules engine (3.4.4 / 3.7.3) ──────────────────────────────
router.get('/regulatory-rules', async (req, res) => {
  try {
    const { projectId } = req.query;
    let where = 'WHERE env_id = @envId';
    const params = { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } };
    if (projectId) {
      where += ' AND (project_id = @projectId OR project_id IS NULL)';
      params.projectId = { type: sql.UniqueIdentifier, value: projectId };
    }
    const rules = await query(
      `SELECT id, project_id, field_name, operator, threshold_value, severity, description, regulatory_reference, created_at
       FROM regulatory_rules
       ${where}
       ORDER BY created_at DESC`,
      params
    );
    res.json({ success: true, rules: rules.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch rules.' });
  }
});

router.post('/regulatory-rules',
  validate([
    body('fieldName').trim().notEmpty().withMessage('fieldName is required.'),
    body('operator').isIn(['GT', 'LT', 'EQ', 'NEQ']).withMessage('Invalid operator.'),
    body('thresholdValue').isFloat().withMessage('thresholdValue must be numeric.'),
    body('severity').isIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).withMessage('Invalid severity.'),
    body('description').trim().notEmpty().withMessage('description is required.'),
  ]),
  async (req, res) => {
    try {
      const { projectId = null, fieldName, operator, thresholdValue, severity, description, regulatoryReference = null } = req.body;
      await query(
        `INSERT INTO regulatory_rules
          (id, env_id, project_id, field_name, operator, threshold_value, severity, description, regulatory_reference, created_by)
         VALUES
          (NEWID(), @envId, @projectId, @fieldName, @operator, @thresholdValue, @severity, @description, @regRef, @createdBy)`,
        {
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          projectId: { type: sql.UniqueIdentifier, value: projectId },
          fieldName: { type: sql.NVarChar(100), value: fieldName },
          operator: { type: sql.NVarChar(10), value: operator },
          thresholdValue: { type: sql.Decimal(18, 4), value: Number(thresholdValue) },
          severity: { type: sql.NVarChar(10), value: severity },
          description: { type: sql.NVarChar(sql.MAX), value: description },
          regRef: { type: sql.NVarChar(255), value: regulatoryReference },
          createdBy: { type: sql.UniqueIdentifier, value: req.user.id },
        }
      );
      res.status(201).json({ success: true, message: 'Rule created.' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to create rule.' });
    }
  }
);

router.get('/compliance-breaches', async (req, res) => {
  try {
    const { status, projectId } = req.query;
    let where = 'WHERE b.env_id = @envId';
    const params = { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } };
    if (status) {
      where += ' AND b.status = @status';
      params.status = { type: sql.NVarChar(20), value: status };
    }
    if (projectId) {
      where += ' AND b.project_id = @projectId';
      params.projectId = { type: sql.UniqueIdentifier, value: projectId };
    }
    const logs = await query(
      `SELECT b.id, b.project_id, p.name as project_name, b.file_id, b.version_id, b.field_name, b.severity, b.description,
              b.regulatory_reference, b.status, b.created_at, cu.full_name as created_by_name
       FROM constraint_breach_logs b
       JOIN projects p ON p.id = b.project_id
       LEFT JOIN users cu ON cu.id = b.created_by
       ${where}
       ORDER BY b.created_at DESC`,
      params
    );
    res.json({ success: true, breaches: logs.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch breach logs.' });
  }
});

module.exports = router;
