const express = require('express');
const { body, query: q, validationResult } = require('express-validator');
const { query, sql } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditLog } = require('../utils/auditLog');
const { notify } = require('../utils/notify');

const router = express.Router();

const ROOT_CAUSES = [
  'MODEL_ASSUMPTION_ERROR',
  'DATA_SOURCE_MISMATCH',
  'SCHEMA_CHANGE',
  'CA_DATA_ENTRY_ERROR',
  'EXTERNAL_MARKET_CHANGE',
  'OTHER',
];

const validate = (vs) => async (req, res, next) => {
  await Promise.all(vs.map((v) => v.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
};

router.use(authenticate);

// ── Static routes must come BEFORE parameterized routes ──

// ── Non-project-scoped admin routes ──
router.get('/rules/list', async (req, res) => {
  try {
    const { projectId } = req.query;
    let where = 'WHERE env_id = @envId';
    const params = { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } };
    if (projectId) {
      where += ' AND (project_id = @projectId OR project_id IS NULL)';
      params.projectId = { type: sql.UniqueIdentifier, value: projectId };
    }
    const rules = await query(
      `SELECT * FROM conflict_rules ${where} ORDER BY created_at DESC`,
      params
    );
    res.json({ success: true, rules: rules.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch conflict rules.' });
  }
});

router.post(
  '/rules',
  requireRole('admin', 'platform_admin', 'super_admin'),
  validate([
    body('dsField').trim().notEmpty().withMessage('dsField is required.'),
    body('caField').trim().notEmpty().withMessage('caField is required.'),
    body('acceptableVariancePercent').isFloat({ min: 0 }).withMessage('acceptableVariancePercent must be >= 0.'),
    body('severity').isIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).withMessage('Invalid severity.'),
  ]),
  async (req, res) => {
    try {
      const { projectId = null, dsField, caField, acceptableVariancePercent, severity, isRegulatoryField = false } = req.body;
      await query(
        `INSERT INTO conflict_rules
           (id, env_id, project_id, ds_field, ca_field, acceptable_variance_percent, severity, is_regulatory_field, created_by, created_at)
         VALUES
           (NEWID(), @envId, @projectId, @dsField, @caField, @variance, @severity, @isRegulatoryField, @createdBy, GETUTCDATE())`,
        {
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          projectId: { type: sql.UniqueIdentifier, value: projectId },
          dsField: { type: sql.NVarChar(120), value: dsField.trim() },
          caField: { type: sql.NVarChar(120), value: caField.trim() },
          variance: { type: sql.Decimal(10, 4), value: Number(acceptableVariancePercent) },
          severity: { type: sql.NVarChar(10), value: severity },
          isRegulatoryField: { type: sql.Bit, value: isRegulatoryField ? 1 : 0 },
          createdBy: { type: sql.UniqueIdentifier, value: req.user.id },
        }
      );
      res.status(201).json({ success: true, message: 'Conflict rule created.' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to create conflict rule.' });
    }
  }
);

router.get('/settings', requireRole('admin', 'platform_admin', 'super_admin'), async (req, res) => {
  try {
    const s = await query(
      `SELECT TOP 1 sla_days FROM conflict_settings WHERE env_id = @envId`,
      { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
    );
    res.json({ success: true, settings: { slaDays: Number(s.recordset[0]?.sla_days || 5) } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch conflict settings.' });
  }
});

router.put(
  '/settings',
  requireRole('admin', 'platform_admin', 'super_admin'),
  validate([body('slaDays').isInt({ min: 1, max: 30 }).withMessage('slaDays must be between 1 and 30.')]),
  async (req, res) => {
    try {
      const { slaDays } = req.body;
      await query(
        `IF EXISTS (SELECT 1 FROM conflict_settings WHERE env_id = @envId)
           UPDATE conflict_settings SET sla_days = @slaDays, updated_at = GETUTCDATE() WHERE env_id = @envId
         ELSE
           INSERT INTO conflict_settings (id, env_id, sla_days, updated_at) VALUES (NEWID(), @envId, @slaDays, GETUTCDATE())`,
        {
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          slaDays: { type: sql.Int, value: Number(slaDays) },
        }
      );
      res.json({ success: true, message: 'Conflict SLA updated.' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to update settings.' });
    }
  }
);

router.get(
  '/trend-report',
  requireRole('admin', 'platform_admin', 'super_admin'),
  validate([q('projectId').optional().isUUID().withMessage('projectId must be a GUID.')]),
  async (req, res) => {
    try {
      const { projectId, month = null } = req.query;
      let where = 'WHERE c.env_id = @envId';
      const params = { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } };
      if (projectId) {
        where += ' AND c.project_id = @projectId';
        params.projectId = { type: sql.UniqueIdentifier, value: projectId };
      }
      if (month) {
        where += ' AND FORMAT(c.created_at, \'yyyy-MM\') = @month';
        params.month = { type: sql.NVarChar(7), value: month };
      }

      const byCategory = await query(
        `SELECT ISNULL(root_cause_category, 'UNCLASSIFIED') as category, COUNT(*) as total
         FROM conflict_records c
         ${where}
         GROUP BY root_cause_category
         ORDER BY total DESC`,
        params
      );

      const summary = await query(
        `SELECT
           COUNT(*) as total_conflicts,
           SUM(CASE WHEN status = 'RESOLVED' THEN 1 ELSE 0 END) as resolved_conflicts,
           AVG(CASE WHEN resolved_at IS NOT NULL THEN DATEDIFF(hour, created_at, resolved_at) END) as avg_resolution_hours
         FROM conflict_records c
         ${where}`,
        params
      );

      const repeatFields = await query(
        `SELECT TOP 10 field_name, COUNT(*) as occurrences
         FROM conflict_records c
         ${where}
         GROUP BY field_name
         ORDER BY occurrences DESC`,
        params
      );

      res.json({
        success: true,
        report: {
          summary: summary.recordset[0] || {},
          byCategory: byCategory.recordset,
          repeatFields: repeatFields.recordset,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to generate conflict trend report.' });
    }
  }
);

// ── Project-scoped conflict routes (require project membership) ──

const requireProjectMembership = async (req, res, next) => {
  const projectId = req.query.projectId || req.body.projectId || req.params.projectId;
  if (!projectId) return res.status(400).json({ success: false, message: 'projectId is required.' });
  const isAdmin = ['admin', 'platform_admin', 'super_admin'].includes(req.user.role);
  if (isAdmin) return next();

  const access = await query(
    `SELECT TOP 1 pm.id
     FROM project_members pm
     JOIN projects p ON p.id = pm.project_id
     WHERE pm.project_id = @pid
       AND pm.user_id = @uid
       AND pm.is_active = 1
       AND p.env_id = @envId`,
    {
      pid: { type: sql.UniqueIdentifier, value: projectId },
      uid: { type: sql.UniqueIdentifier, value: req.user.id },
      envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
    }
  );
  if (!access.recordset.length) {
    return res.status(403).json({ success: false, message: 'Access denied for this project.' });
  }
  return next();
};

const maybeEscalateBreachedSla = async ({ envId, io }) => {
  const settings = await query(
    `SELECT TOP 1 sla_days FROM conflict_settings WHERE env_id = @envId`,
    { envId: { type: sql.UniqueIdentifier, value: envId } }
  );
  const slaDays = Number(settings.recordset[0]?.sla_days || 5);

  const dueForEscalation = await query(
    `SELECT c.id, c.project_id, c.field_name, c.created_at, p.name as project_name
     FROM conflict_records c
     JOIN projects p ON p.id = c.project_id
     WHERE c.env_id = @envId
       AND c.status IN ('OPEN', 'IN_RESOLUTION')
       AND c.escalated_at IS NULL
       AND DATEDIFF(day, c.created_at, GETUTCDATE()) >= @slaDays`,
    {
      envId: { type: sql.UniqueIdentifier, value: envId },
      slaDays: { type: sql.Int, value: slaDays },
    }
  );

  for (const c of dueForEscalation.recordset) {
    await query(
      `UPDATE conflict_records
       SET status = 'ESCALATED', escalated_at = GETUTCDATE(), updated_at = GETUTCDATE()
       WHERE id = @id`,
      { id: { type: sql.UniqueIdentifier, value: c.id } }
    );

    const admins = await query(
      `SELECT id FROM users
       WHERE env_id = @envId
         AND role IN ('admin', 'platform_admin', 'super_admin')
         AND status = 'active'`,
      { envId: { type: sql.UniqueIdentifier, value: envId } }
    );

    for (const a of admins.recordset) {
      await notify({
        userId: a.id,
        type: 'conflict_escalated',
        title: 'Conflict Escalated (SLA Breach)',
        body: `Conflict on "${c.field_name}" in ${c.project_name} exceeded SLA and was escalated.`,
        refId: c.id,
        io,
      });

      // high-priority admin task on escalation
      await query(
        `INSERT INTO tasks (id, project_id, env_id, title, description, priority, status, type, assigned_to, created_by, due_date)
         VALUES (NEWID(), @pid, @envId, @title, @description, 'Critical', 'todo', 'OTHER', @assignedTo, @createdBy, DATEADD(day, 2, CAST(GETUTCDATE() AS DATE)))`,
        {
          pid: { type: sql.UniqueIdentifier, value: c.project_id },
          envId: { type: sql.UniqueIdentifier, value: envId },
          title: { type: sql.NVarChar(200), value: `Escalated conflict: ${c.field_name}` },
          description: { type: sql.NVarChar(sql.MAX), value: `SLA breach escalation for conflict ${c.id}. Please arbitrate resolution.` },
          assignedTo: { type: sql.UniqueIdentifier, value: a.id },
          createdBy: { type: sql.UniqueIdentifier, value: a.id },
        }
      );
    }
  }
};

router.get(
  '/',
  validate([q('projectId').isUUID().withMessage('projectId is required.')]),
  requireProjectMembership,
  async (req, res) => {
    try {
      await maybeEscalateBreachedSla({ envId: req.user.env_id, io: req.app.get('io') });
      const { projectId, status } = req.query;
      let where = 'WHERE c.env_id = @envId AND c.project_id = @projectId';
      const params = {
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        projectId: { type: sql.UniqueIdentifier, value: projectId },
      };
      if (status) {
        where += ' AND c.status = @status';
        params.status = { type: sql.NVarChar(20), value: status };
      }
      const result = await query(
        `SELECT c.*, p.name as project_name
         FROM conflict_records c
         JOIN projects p ON p.id = c.project_id
         ${where}
         ORDER BY c.created_at DESC`,
        params
      );
      res.json({ success: true, conflicts: result.recordset });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to fetch conflicts.' });
    }
  }
);

router.post(
  '/:id/root-cause',
  validate([
    body('rootCauseCategory').isIn(ROOT_CAUSES).withMessage('Invalid root cause category.'),
    body('rootCauseNote').trim().isLength({ min: 50 }).withMessage('rootCauseNote must be at least 50 chars.'),
  ]),
  async (req, res) => {
    try {
      if (req.user.team !== 'DS' && !['admin', 'platform_admin', 'super_admin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Only DS members/admins can submit root cause analysis.' });
      }
      const { id } = req.params;
      const { rootCauseCategory, rootCauseNote } = req.body;
      const found = await query(
        `SELECT TOP 1 id, status FROM conflict_records WHERE id = @id AND env_id = @envId`,
        {
          id: { type: sql.UniqueIdentifier, value: id },
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        }
      );
      if (!found.recordset.length) return res.status(404).json({ success: false, message: 'Conflict not found.' });
      await query(
        `UPDATE conflict_records
         SET root_cause_category = @cat,
             root_cause_note = @note,
             status = CASE WHEN status = 'OPEN' THEN 'IN_RESOLUTION' ELSE status END,
             updated_at = GETUTCDATE()
         WHERE id = @id`,
        {
          id: { type: sql.UniqueIdentifier, value: id },
          cat: { type: sql.NVarChar(40), value: rootCauseCategory },
          note: { type: sql.NVarChar(sql.MAX), value: rootCauseNote.trim() },
        }
      );
      await auditLog({
        envId: req.user.env_id,
        actorId: req.user.id,
        actionType: 'conflict_root_cause_added',
        targetType: 'conflict',
        targetId: id,
        metadata: { rootCauseCategory },
        ipAddress: req.ip,
      });
      res.json({ success: true, message: 'Root cause analysis saved.' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to update root cause.' });
    }
  }
);

router.post(
  '/:id/ca-response',
  validate([
    body('responseType').isIn(['CONFIRM', 'DISPUTE', 'ESCALATE']).withMessage('responseType must be CONFIRM, DISPUTE, or ESCALATE.'),
    body('responseNote').trim().isLength({ min: 5 }).withMessage('responseNote is required.'),
  ]),
  async (req, res) => {
    try {
      if (req.user.team !== 'CA' && !['admin', 'platform_admin', 'super_admin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Only CA members/admins can submit CA responses.' });
      }
      const { id } = req.params;
      const { responseType, responseNote } = req.body;
      const nextStatus = responseType === 'ESCALATE' ? 'ESCALATED' : 'IN_RESOLUTION';
      await query(
        `UPDATE conflict_records
         SET ca_response_type = @rType,
             ca_response_note = @rNote,
             status = @status,
             escalated_at = CASE WHEN @status = 'ESCALATED' THEN GETUTCDATE() ELSE escalated_at END,
             updated_at = GETUTCDATE()
         WHERE id = @id AND env_id = @envId`,
        {
          id: { type: sql.UniqueIdentifier, value: id },
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          rType: { type: sql.NVarChar(20), value: responseType },
          rNote: { type: sql.NVarChar(sql.MAX), value: responseNote.trim() },
          status: { type: sql.NVarChar(20), value: nextStatus },
        }
      );
      await auditLog({
        envId: req.user.env_id,
        actorId: req.user.id,
        actionType: 'conflict_ca_response',
        targetType: 'conflict',
        targetId: id,
        metadata: { responseType },
        ipAddress: req.ip,
      });
      res.json({ success: true, message: 'CA response recorded.' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to record response.' });
    }
  }
);

router.post(
  '/:id/reconciliation',
  validate([body('reconciliationDecision').trim().isLength({ min: 5 }).withMessage('reconciliationDecision is required.')]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reconciliationDecision } = req.body;
      await query(
        `UPDATE conflict_records
         SET reconciliation_decision = @decision, updated_at = GETUTCDATE()
         WHERE id = @id AND env_id = @envId`,
        {
          id: { type: sql.UniqueIdentifier, value: id },
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          decision: { type: sql.NVarChar(sql.MAX), value: reconciliationDecision.trim() },
        }
      );
      res.json({ success: true, message: 'Reconciliation decision saved.' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to save reconciliation decision.' });
    }
  }
);

router.post('/:id/confirm', async (req, res) => {
  try {
    const { id } = req.params;
    const field = req.user.team === 'CA' ? 'ca_confirmed' : req.user.team === 'DS' ? 'ds_confirmed' : null;
    if (!field) {
      return res.status(403).json({ success: false, message: 'Only CA/DS members can confirm conflict resolution.' });
    }

    await query(
      `UPDATE conflict_records SET ${field} = 1, updated_at = GETUTCDATE() WHERE id = @id AND env_id = @envId`,
      {
        id: { type: sql.UniqueIdentifier, value: id },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );

    const c = await query(
      `SELECT TOP 1 ca_confirmed, ds_confirmed, reconciliation_decision, status
       FROM conflict_records
       WHERE id = @id AND env_id = @envId`,
      {
        id: { type: sql.UniqueIdentifier, value: id },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );
    const row = c.recordset[0];
    if (row && row.ca_confirmed && row.ds_confirmed && row.reconciliation_decision && row.status !== 'RESOLVED') {
      await query(
        `UPDATE conflict_records
         SET status = 'RESOLVED', resolved_at = GETUTCDATE(), resolved_by = @uid, updated_at = GETUTCDATE()
         WHERE id = @id`,
        {
          id: { type: sql.UniqueIdentifier, value: id },
          uid: { type: sql.UniqueIdentifier, value: req.user.id },
        }
      );
    }

    res.json({ success: true, message: 'Confirmation saved.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to confirm conflict.' });
  }
});

module.exports = router;
