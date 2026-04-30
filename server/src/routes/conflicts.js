const express = require('express');
const { body, query: q, validationResult } = require('express-validator');
const { query, sql } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditLog } = require('../utils/auditLog');
const { notify } = require('../utils/notify');

const router = express.Router();

const ROOT_CAUSES = [
  'MODEL_ASSUMPTION_ERROR','DATA_SOURCE_MISMATCH','SCHEMA_CHANGE',
  'CA_DATA_ENTRY_ERROR','EXTERNAL_MARKET_CHANGE','OTHER',
];

const validate = (vs) => async (req, res, next) => {
  await Promise.all(vs.map((v) => v.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
};

router.use(authenticate);

/* ─────────────────────────────────────────────────────────
   3.7.1  CONFLICT RULES  (Admin CRUD)
   ───────────────────────────────────────────────────────── */

router.get('/rules/list', async (req, res) => {
  try {
    const { projectId } = req.query;
    let where = 'WHERE env_id = @envId';
    const params = { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } };
    if (projectId) {
      where += ' AND (project_id = @projectId OR project_id IS NULL)';
      params.projectId = { type: sql.UniqueIdentifier, value: projectId };
    }
    const rules = await query(`SELECT * FROM conflict_rules ${where} ORDER BY created_at DESC`, params);
    res.json({ success: true, rules: rules.recordset });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch conflict rules.' }); }
});

router.post('/rules',
  requireRole('admin','platform_admin','super_admin'),
  validate([
    body('dsField').trim().notEmpty(),
    body('caField').trim().notEmpty(),
    body('acceptableVariancePercent').isFloat({ min: 0 }),
    body('severity').isIn(['LOW','MEDIUM','HIGH','CRITICAL']),
  ]),
  async (req, res) => {
    try {
      const { projectId = null, dsField, caField, acceptableVariancePercent, severity, isRegulatoryField = false } = req.body;
      await query(
        `INSERT INTO conflict_rules (id,env_id,project_id,ds_field,ca_field,acceptable_variance_percent,severity,is_regulatory_field,created_by,created_at)
         VALUES (NEWID(),@envId,@projectId,@dsField,@caField,@variance,@severity,@isReg,@createdBy,GETUTCDATE())`,
        {
          envId:     { type: sql.UniqueIdentifier, value: req.user.env_id },
          projectId: { type: sql.UniqueIdentifier, value: projectId },
          dsField:   { type: sql.NVarChar(120), value: dsField.trim() },
          caField:   { type: sql.NVarChar(120), value: caField.trim() },
          variance:  { type: sql.Decimal(10,4), value: Number(acceptableVariancePercent) },
          severity:  { type: sql.NVarChar(10), value: severity },
          isReg:     { type: sql.Bit, value: isRegulatoryField ? 1 : 0 },
          createdBy: { type: sql.UniqueIdentifier, value: req.user.id },
        }
      );
      await auditLog({ envId: req.user.env_id, actorId: req.user.id, actionType: 'conflict_rule_created', targetType: 'conflict_rule', metadata: { dsField, caField, severity }, ipAddress: req.ip });
      res.status(201).json({ success: true, message: 'Conflict rule created.' });
    } catch (err) { res.status(500).json({ success: false, message: 'Failed to create conflict rule.' }); }
  }
);

router.delete('/rules/:id',
  requireRole('admin','platform_admin','super_admin'),
  async (req, res) => {
    try {
      await query(`DELETE FROM conflict_rules WHERE id = @id AND env_id = @envId`, {
        id:    { type: sql.UniqueIdentifier, value: req.params.id },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      });
      res.json({ success: true, message: 'Rule deleted.' });
    } catch (err) { res.status(500).json({ success: false, message: 'Failed to delete rule.' }); }
  }
);

/* ─────────────────────────────────────────────────────────
   3.7.1  AUTOMATED DETECTION ENGINE
   ───────────────────────────────────────────────────────── */

router.post('/detect',
  validate([body('projectId').isUUID(), body('dsData').isObject(), body('caData').isObject()]),
  async (req, res) => {
    try {
      const { projectId, dsData, caData, periodLabel = null } = req.body;
      const rules = await query(
        `SELECT * FROM conflict_rules WHERE env_id = @envId AND (project_id = @pid OR project_id IS NULL)`,
        { envId: { type: sql.UniqueIdentifier, value: req.user.env_id }, pid: { type: sql.UniqueIdentifier, value: projectId } }
      );
      const detected = [];
      for (const rule of rules.recordset) {
        const dsVal = Number(dsData[rule.ds_field]);
        const caVal = Number(caData[rule.ca_field]);
        if (isNaN(dsVal) || isNaN(caVal)) continue;
        const delta = Math.abs(dsVal - caVal);
        const base = caVal === 0 ? 1 : Math.abs(caVal);
        const deltaPct = (delta / base) * 100;
        if (deltaPct > Number(rule.acceptable_variance_percent)) {
          const ins = await query(
            `INSERT INTO conflict_records (id,env_id,project_id,conflict_rule_id,field_name,ds_value,ca_actual_value,delta,delta_percent,severity,period_label,status,created_at,updated_at)
             OUTPUT INSERTED.id
             VALUES (NEWID(),@envId,@pid,@ruleId,@field,@dsVal,@caVal,@delta,@deltaPct,@sev,@period,'OPEN',GETUTCDATE(),GETUTCDATE())`,
            {
              envId:    { type: sql.UniqueIdentifier, value: req.user.env_id },
              pid:      { type: sql.UniqueIdentifier, value: projectId },
              ruleId:   { type: sql.UniqueIdentifier, value: rule.id },
              field:    { type: sql.NVarChar(120), value: rule.ds_field },
              dsVal:    { type: sql.Decimal(18,4), value: dsVal },
              caVal:    { type: sql.Decimal(18,4), value: caVal },
              delta:    { type: sql.Decimal(18,4), value: delta },
              deltaPct: { type: sql.Decimal(18,4), value: deltaPct },
              sev:      { type: sql.NVarChar(10), value: rule.severity },
              period:   { type: sql.NVarChar(50), value: periodLabel },
            }
          );
          detected.push({ id: ins.recordset[0].id, field: rule.ds_field, dsVal, caVal, delta, deltaPct, severity: rule.severity, isRegulatory: rule.is_regulatory_field });
          // If regulatory field, auto-create breach log
          if (rule.is_regulatory_field) {
            await query(
              `INSERT INTO constraint_breach_logs (id,env_id,project_id,field_name,severity,description,created_by)
               VALUES (NEWID(),@envId,@pid,@field,@sev,@desc,@uid)`,
              {
                envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
                pid:   { type: sql.UniqueIdentifier, value: projectId },
                field: { type: sql.NVarChar(100), value: rule.ds_field },
                sev:   { type: sql.NVarChar(10), value: rule.severity },
                desc:  { type: sql.NVarChar(sql.MAX), value: `Auto-detected regulatory conflict on ${rule.ds_field}: DS=${dsVal}, CA=${caVal}, Δ=${deltaPct.toFixed(2)}%` },
                uid:   { type: sql.UniqueIdentifier, value: req.user.id },
              }
            );
          }
        }
      }
      await auditLog({ envId: req.user.env_id, actorId: req.user.id, actionType: 'conflict_detection_run', targetType: 'project', targetId: projectId, metadata: { detected: detected.length }, ipAddress: req.ip });
      const io = req.app.get('io');
      if (io && detected.length > 0) {
        io.to(`project:${projectId}`).emit('conflicts_detected', { count: detected.length, conflicts: detected });
      }
      res.json({ success: true, detected: detected.length, conflicts: detected });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'Detection failed.' }); }
  }
);

/* ─────────────────────────────────────────────────────────
   3.7.1  LIST CONFLICTS
   ───────────────────────────────────────────────────────── */

router.get('/',
  async (req, res) => {
    try {
      const { projectId, status } = req.query;
      let where = 'WHERE c.env_id = @envId';
      const params = {
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      };
      if (projectId) { where += ' AND c.project_id = @pid'; params.pid = { type: sql.UniqueIdentifier, value: projectId }; }
      if (status) { where += ' AND c.status = @status'; params.status = { type: sql.NVarChar(20), value: status }; }
      const result = await query(`SELECT c.*, p.name as project_name FROM conflict_records c LEFT JOIN projects p ON p.id=c.project_id ${where} ORDER BY c.created_at DESC`, params);
      res.json({ success: true, conflicts: result.recordset });
    } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch conflicts.' }); }
  }
);

/* ─────────────────────────────────────────────────────────
   3.7.2  RESOLUTION WORKFLOW
   ───────────────────────────────────────────────────────── */

// DS submits root-cause analysis
router.post('/:id/root-cause',
  validate([
    body('rootCauseCategory').isIn(ROOT_CAUSES),
    body('rootCauseNote').trim().isLength({ min: 50 }),
  ]),
  async (req, res) => {
    try {
      // DS team or any admin can submit root cause
      const isAdmin = ['admin','platform_admin','super_admin'].includes(req.user.role);
      if (req.user.team !== 'DS' && !isAdmin)
        return res.status(403).json({ success: false, message: 'Only DS members or admins can submit root cause.' });
      const { id } = req.params;
      const { rootCauseCategory, rootCauseNote } = req.body;
      const found = await query(`SELECT TOP 1 id,status FROM conflict_records WHERE id=@id AND env_id=@envId`, { id: { type: sql.UniqueIdentifier, value: id }, envId: { type: sql.UniqueIdentifier, value: req.user.env_id } });
      if (!found.recordset.length) return res.status(404).json({ success: false, message: 'Conflict not found.' });
      await query(
        `UPDATE conflict_records SET root_cause_category=@cat, root_cause_note=@note, status=CASE WHEN status='OPEN' THEN 'IN_RESOLUTION' ELSE status END, updated_at=GETUTCDATE() WHERE id=@id`,
        { id: { type: sql.UniqueIdentifier, value: id }, cat: { type: sql.NVarChar(40), value: rootCauseCategory }, note: { type: sql.NVarChar(sql.MAX), value: rootCauseNote.trim() } }
      );
      await auditLog({ envId: req.user.env_id, actorId: req.user.id, actionType: 'conflict_root_cause_added', targetType: 'conflict', targetId: id, metadata: { rootCauseCategory }, ipAddress: req.ip });
      // Return updated conflict so client can refresh the selected item
      const updated = await query(`SELECT * FROM conflict_records WHERE id=@id`, { id: { type: sql.UniqueIdentifier, value: id } });
      res.json({ success: true, message: 'Root cause analysis saved.', conflict: updated.recordset[0] });
    } catch (err) { console.error('Root cause error:', err); res.status(500).json({ success: false, message: 'Failed to update root cause.' }); }
  }
);

// CA responds: CONFIRM, DISPUTE, or ESCALATE
router.post('/:id/ca-response',
  validate([
    body('responseType').isIn(['CONFIRM','DISPUTE','ESCALATE']),
    body('responseNote').trim().isLength({ min: 5 }),
  ]),
  async (req, res) => {
    try {
      // CA team or any admin can respond
      const isAdmin = ['admin','platform_admin','super_admin'].includes(req.user.role);
      if (req.user.team !== 'CA' && !isAdmin)
        return res.status(403).json({ success: false, message: 'Only CA members or admins can respond.' });
      const { id } = req.params;
      const { responseType, responseNote } = req.body;
      const nextStatus = responseType === 'ESCALATE' ? 'ESCALATED' : 'IN_RESOLUTION';
      await query(
        `UPDATE conflict_records SET ca_response_type=@rType, ca_response_note=@rNote, status=@status, escalated_at=CASE WHEN @status='ESCALATED' THEN GETUTCDATE() ELSE escalated_at END, updated_at=GETUTCDATE() WHERE id=@id AND env_id=@envId`,
        { id: { type: sql.UniqueIdentifier, value: id }, envId: { type: sql.UniqueIdentifier, value: req.user.env_id }, rType: { type: sql.NVarChar(20), value: responseType }, rNote: { type: sql.NVarChar(sql.MAX), value: responseNote.trim() }, status: { type: sql.NVarChar(20), value: nextStatus } }
      );
      await auditLog({ envId: req.user.env_id, actorId: req.user.id, actionType: 'conflict_ca_response', targetType: 'conflict', targetId: id, metadata: { responseType }, ipAddress: req.ip });
      const updated = await query(`SELECT * FROM conflict_records WHERE id=@id`, { id: { type: sql.UniqueIdentifier, value: id } });
      res.json({ success: true, message: 'CA response recorded.', conflict: updated.recordset[0] });
    } catch (err) { console.error('CA response error:', err); res.status(500).json({ success: false, message: 'Failed to record response.' }); }
  }
);

// Reconciliation decision
router.post('/:id/reconciliation',
  validate([body('reconciliationDecision').trim().isLength({ min: 5 })]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reconciliationDecision } = req.body;
      await query(`UPDATE conflict_records SET reconciliation_decision=@decision, updated_at=GETUTCDATE() WHERE id=@id AND env_id=@envId`,
        { id: { type: sql.UniqueIdentifier, value: id }, envId: { type: sql.UniqueIdentifier, value: req.user.env_id }, decision: { type: sql.NVarChar(sql.MAX), value: reconciliationDecision.trim() } }
      );
      const updated = await query(`SELECT * FROM conflict_records WHERE id=@id`, { id: { type: sql.UniqueIdentifier, value: id } });
      res.json({ success: true, message: 'Reconciliation decision saved.', conflict: updated.recordset[0] });
    } catch (err) { res.status(500).json({ success: false, message: 'Failed to save reconciliation.' }); }
  }
);

// Mutual confirmation — both CA and DS must confirm to resolve
router.post('/:id/confirm', async (req, res) => {
  try {
    const { id } = req.params;
    const isAdmin = ['admin','platform_admin','super_admin'].includes(req.user.role);
    const field = req.user.team === 'CA' ? 'ca_confirmed' : req.user.team === 'DS' ? 'ds_confirmed' : null;
    if (!field && !isAdmin)
      return res.status(403).json({ success: false, message: 'Only CA/DS members can confirm.' });

    // Admins set BOTH flags to force-resolve; regular members set only their side
    if (isAdmin && !field) {
      await query(`UPDATE conflict_records SET ca_confirmed=1, ds_confirmed=1, updated_at=GETUTCDATE() WHERE id=@id AND env_id=@envId`,
        { id: { type: sql.UniqueIdentifier, value: id }, envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
      );
    } else {
      const confirmField = field || 'ca_confirmed';
      await query(`UPDATE conflict_records SET ${confirmField}=1, updated_at=GETUTCDATE() WHERE id=@id AND env_id=@envId`,
        { id: { type: sql.UniqueIdentifier, value: id }, envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
      );
    }

    const c = await query(`SELECT TOP 1 * FROM conflict_records WHERE id=@id AND env_id=@envId`,
      { id: { type: sql.UniqueIdentifier, value: id }, envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
    );
    const row = c.recordset[0];
    if (row && row.ca_confirmed && row.ds_confirmed && row.reconciliation_decision && row.status !== 'RESOLVED') {
      await query(`UPDATE conflict_records SET status='RESOLVED', resolved_at=GETUTCDATE(), resolved_by=@uid, updated_at=GETUTCDATE() WHERE id=@id AND env_id=@envId`,
        { id: { type: sql.UniqueIdentifier, value: id }, uid: { type: sql.UniqueIdentifier, value: req.user.id }, envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
      );
    }
    // Return updated conflict
    const updated = await query(`SELECT * FROM conflict_records WHERE id=@id AND env_id=@envId`, { id: { type: sql.UniqueIdentifier, value: id }, envId: { type: sql.UniqueIdentifier, value: req.user.env_id } });
    res.json({ success: true, message: 'Confirmation saved.', conflict: updated.recordset[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to confirm.' }); }
});

/* ─────────────────────────────────────────────────────────
   3.7.3  REGULATORY PRE-CHECK (Publication Gate)
   ───────────────────────────────────────────────────────── */

router.post('/precheck',
  validate([body('projectId').isUUID(), body('dataSnapshot').isObject()]),
  async (req, res) => {
    try {
      const { projectId, dataSnapshot } = req.body;
      const rules = await query(
        `SELECT * FROM regulatory_rules WHERE env_id=@envId AND (project_id IS NULL OR project_id=@pid)`,
        { envId: { type: sql.UniqueIdentifier, value: req.user.env_id }, pid: { type: sql.UniqueIdentifier, value: projectId } }
      );
      const compareRule = (op, val, thresh) => {
        if (op === 'GT') return val > thresh;
        if (op === 'LT') return val < thresh;
        if (op === 'EQ') return val === thresh;
        if (op === 'NEQ') return val !== thresh;
        return false;
      };
      const violations = [];
      for (const rule of rules.recordset) {
        const val = dataSnapshot[rule.field_name];
        if (val === undefined || val === null || isNaN(Number(val))) continue;
        if (compareRule(rule.operator, Number(val), Number(rule.threshold_value))) {
          violations.push({ ruleId: rule.id, fieldName: rule.field_name, value: Number(val), threshold: Number(rule.threshold_value), severity: rule.severity, description: rule.description, regulatoryReference: rule.regulatory_reference });
        }
      }
      await auditLog({ envId: req.user.env_id, actorId: req.user.id, actionType: 'regulatory_precheck_run', targetType: 'project', targetId: projectId, metadata: { passed: violations.length === 0, violations: violations.length }, ipAddress: req.ip });
      if (violations.length > 0) {
        return res.status(400).json({ success: false, message: 'Publication blocked by regulatory pre-check.', precheck: { passed: false, violations } });
      }
      res.json({ success: true, precheck: { passed: true, violations: [] } });
    } catch (err) { res.status(500).json({ success: false, message: 'Pre-check failed.' }); }
  }
);

/* ─────────────────────────────────────────────────────────
   SLA SETTINGS & ESCALATION
   ───────────────────────────────────────────────────────── */

router.get('/settings', requireRole('admin','platform_admin','super_admin'), async (req, res) => {
  try {
    const s = await query(`SELECT TOP 1 sla_days FROM conflict_settings WHERE env_id=@envId`, { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } });
    res.json({ success: true, settings: { slaDays: Number(s.recordset[0]?.sla_days || 5) } });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch settings.' }); }
});

router.put('/settings',
  requireRole('admin','platform_admin','super_admin'),
  validate([body('slaDays').isInt({ min: 1, max: 30 })]),
  async (req, res) => {
    try {
      const { slaDays } = req.body;
      await query(
        `IF EXISTS (SELECT 1 FROM conflict_settings WHERE env_id=@envId)
           UPDATE conflict_settings SET sla_days=@sla, updated_at=GETUTCDATE() WHERE env_id=@envId
         ELSE
           INSERT INTO conflict_settings (id,env_id,sla_days,updated_at) VALUES (NEWID(),@envId,@sla,GETUTCDATE())`,
        { envId: { type: sql.UniqueIdentifier, value: req.user.env_id }, sla: { type: sql.Int, value: Number(slaDays) } }
      );
      res.json({ success: true, message: 'SLA updated.' });
    } catch (err) { res.status(500).json({ success: false, message: 'Failed to update settings.' }); }
  }
);

/* ─────────────────────────────────────────────────────────
   TREND REPORT (Admin)
   ───────────────────────────────────────────────────────── */

router.get('/trend-report',
  requireRole('admin','platform_admin','super_admin'),
  async (req, res) => {
    try {
      const { projectId, month } = req.query;
      let where = 'WHERE c.env_id = @envId';
      const params = { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } };
      if (projectId) { where += ' AND c.project_id=@pid'; params.pid = { type: sql.UniqueIdentifier, value: projectId }; }
      if (month) { where += " AND FORMAT(c.created_at,'yyyy-MM')=@month"; params.month = { type: sql.NVarChar(7), value: month }; }
      const byCategory = await query(`SELECT ISNULL(root_cause_category,'UNCLASSIFIED') as category, COUNT(*) as total FROM conflict_records c ${where} GROUP BY root_cause_category ORDER BY total DESC`, params);
      const summary = await query(`SELECT COUNT(*) as total_conflicts, SUM(CASE WHEN status='RESOLVED' THEN 1 ELSE 0 END) as resolved, AVG(CASE WHEN resolved_at IS NOT NULL THEN DATEDIFF(hour,created_at,resolved_at) END) as avg_resolution_hours FROM conflict_records c ${where}`, params);
      const repeatFields = await query(`SELECT TOP 10 field_name, COUNT(*) as occurrences FROM conflict_records c ${where} GROUP BY field_name ORDER BY occurrences DESC`, params);
      const bySeverity = await query(`SELECT severity, COUNT(*) as total FROM conflict_records c ${where} GROUP BY severity ORDER BY total DESC`, params);
      res.json({ success: true, report: { summary: summary.recordset[0] || {}, byCategory: byCategory.recordset, repeatFields: repeatFields.recordset, bySeverity: bySeverity.recordset } });
    } catch (err) { res.status(500).json({ success: false, message: 'Failed to generate trend report.' }); }
  }
);

module.exports = router;
