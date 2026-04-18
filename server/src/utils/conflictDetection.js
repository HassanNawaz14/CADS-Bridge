const { query, sql } = require('../db');
const { notify } = require('./notify');
const { auditLog } = require('./auditLog');

const detectKpiConflicts = async ({ envId, projectId, io }) => {
  if (!projectId) return [];

  const rules = await query(
    `SELECT id, ds_field, ca_field, acceptable_variance_percent, severity, is_regulatory_field
     FROM conflict_rules
     WHERE env_id = @envId AND (project_id = @projectId OR project_id IS NULL)`,
    {
      envId: { type: sql.UniqueIdentifier, value: envId },
      projectId: { type: sql.UniqueIdentifier, value: projectId },
    }
  );
  if (!rules.recordset.length) return [];

  const created = [];
  for (const r of rules.recordset) {
    const latestDs = await query(
      `SELECT TOP 1 id, metric_value, period_label
       FROM kpi_records
       WHERE env_id = @envId AND project_id = @projectId AND domain = 'DS' AND metric_key = @metricKey
       ORDER BY recorded_at DESC`,
      {
        envId: { type: sql.UniqueIdentifier, value: envId },
        projectId: { type: sql.UniqueIdentifier, value: projectId },
        metricKey: { type: sql.NVarChar(100), value: r.ds_field },
      }
    );
    const latestCa = await query(
      `SELECT TOP 1 id, metric_value, period_label
       FROM kpi_records
       WHERE env_id = @envId AND project_id = @projectId AND domain = 'CA' AND metric_key = @metricKey
       ORDER BY recorded_at DESC`,
      {
        envId: { type: sql.UniqueIdentifier, value: envId },
        projectId: { type: sql.UniqueIdentifier, value: projectId },
        metricKey: { type: sql.NVarChar(100), value: r.ca_field },
      }
    );
    if (!latestDs.recordset.length || !latestCa.recordset.length) continue;

    const ds = latestDs.recordset[0];
    const ca = latestCa.recordset[0];
    if (ds.period_label && ca.period_label && ds.period_label !== ca.period_label) continue;

    const dsVal = Number(ds.metric_value);
    const caVal = Number(ca.metric_value);
    if (Number.isNaN(dsVal) || Number.isNaN(caVal)) continue;

    const delta = dsVal - caVal;
    const deltaPercent = caVal === 0 ? 0 : (delta / caVal) * 100;
    if (Math.abs(deltaPercent) <= Number(r.acceptable_variance_percent)) continue;

    const dedupe = await query(
      `SELECT TOP 1 id
       FROM conflict_records
       WHERE env_id = @envId
         AND project_id = @projectId
         AND field_name = @fieldName
         AND period_label = @periodLabel
         AND status IN ('OPEN', 'IN_RESOLUTION', 'ESCALATED')`,
      {
        envId: { type: sql.UniqueIdentifier, value: envId },
        projectId: { type: sql.UniqueIdentifier, value: projectId },
        fieldName: { type: sql.NVarChar(120), value: r.ds_field },
        periodLabel: { type: sql.NVarChar(50), value: ds.period_label || null },
      }
    );
    if (dedupe.recordset.length) continue;

    const inserted = await query(
      `INSERT INTO conflict_records
         (id, env_id, project_id, conflict_rule_id, field_name, ds_value, ca_actual_value, delta, delta_percent, severity, period_label, status, created_at, updated_at)
       OUTPUT INSERTED.id
       VALUES
         (NEWID(), @envId, @projectId, @ruleId, @fieldName, @dsValue, @caValue, @delta, @deltaPercent, @severity, @periodLabel, 'OPEN', GETUTCDATE(), GETUTCDATE())`,
      {
        envId: { type: sql.UniqueIdentifier, value: envId },
        projectId: { type: sql.UniqueIdentifier, value: projectId },
        ruleId: { type: sql.UniqueIdentifier, value: r.id },
        fieldName: { type: sql.NVarChar(120), value: r.ds_field },
        dsValue: { type: sql.Decimal(18, 4), value: dsVal },
        caValue: { type: sql.Decimal(18, 4), value: caVal },
        delta: { type: sql.Decimal(18, 4), value: delta },
        deltaPercent: { type: sql.Decimal(18, 4), value: deltaPercent },
        severity: { type: sql.NVarChar(10), value: r.severity },
        periodLabel: { type: sql.NVarChar(50), value: ds.period_label || null },
      }
    );
    const conflictId = inserted.recordset[0].id;
    created.push({ id: conflictId, fieldName: r.ds_field, deltaPercent });

    if (r.is_regulatory_field) {
      await query(
        `INSERT INTO constraint_breach_logs
          (id, env_id, project_id, field_name, severity, description, status, created_by, created_at)
         VALUES
          (NEWID(), @envId, @projectId, @fieldName, @severity, @description, 'OPEN', NULL, GETUTCDATE())`,
        {
          envId: { type: sql.UniqueIdentifier, value: envId },
          projectId: { type: sql.UniqueIdentifier, value: projectId },
          fieldName: { type: sql.NVarChar(100), value: r.ds_field },
          severity: { type: sql.NVarChar(10), value: r.severity },
          description: { type: sql.NVarChar(sql.MAX), value: `Regulatory conflict detected for ${r.ds_field} (${deltaPercent.toFixed(2)}% variance).` },
        }
      );
    }

    const users = await query(
      `SELECT DISTINCT pm.user_id
       FROM project_members pm
       WHERE pm.project_id = @projectId AND pm.is_active = 1`,
      { projectId: { type: sql.UniqueIdentifier, value: projectId } }
    );
    for (const u of users.recordset) {
      await notify({
        userId: u.user_id,
        type: 'conflict_detected',
        title: 'CA-DS Conflict Detected',
        body: `A conflict was detected for "${r.ds_field}" (${deltaPercent.toFixed(2)}% variance).`,
        refId: conflictId,
        io,
      });
    }
  }

  if (created.length) {
    await auditLog({
      envId,
      actionType: 'conflicts_auto_detected',
      targetType: 'project',
      targetId: projectId,
      metadata: { count: created.length },
    });
  }

  return created;
};

module.exports = { detectKpiConflicts };
