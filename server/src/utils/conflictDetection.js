const { query, sql } = require('../db');
const { notify } = require('./notify');
const { auditLog } = require('./auditLog');

/**
 * Detect CA-DS conflicts by comparing KPI records against conflict rules.
 * Called automatically after every KPI recording.
 * Works with or without a projectId — if null, scans across all projects + unassigned KPIs.
 */
const detectKpiConflicts = async ({ envId, projectId, io }) => {
  try {
    // Fetch applicable conflict rules
    let rulesQuery, rulesParams;
    if (projectId) {
      rulesQuery = `SELECT id, ds_field, ca_field, acceptable_variance_percent, severity, is_regulatory_field, project_id
                    FROM conflict_rules
                    WHERE env_id = @envId AND (project_id = @projectId OR project_id IS NULL)`;
      rulesParams = {
        envId: { type: sql.UniqueIdentifier, value: envId },
        projectId: { type: sql.UniqueIdentifier, value: projectId },
      };
    } else {
      // No project specified — use global rules (project_id IS NULL)
      rulesQuery = `SELECT id, ds_field, ca_field, acceptable_variance_percent, severity, is_regulatory_field, project_id
                    FROM conflict_rules
                    WHERE env_id = @envId AND project_id IS NULL`;
      rulesParams = { envId: { type: sql.UniqueIdentifier, value: envId } };
    }

    const rules = await query(rulesQuery, rulesParams);
    if (!rules.recordset.length) return [];

    const created = [];

    for (const r of rules.recordset) {
      // Build the KPI query — match project if available, else match unassigned
      const projectFilter = projectId
        ? 'AND project_id = @projectId'
        : ''; // When no project, compare ALL records with same env

      const kpiParams = {
        envId: { type: sql.UniqueIdentifier, value: envId },
        ...(projectId ? { projectId: { type: sql.UniqueIdentifier, value: projectId } } : {}),
      };

      // Get the most recent DS KPI for this field
      const latestDs = await query(
        `SELECT TOP 1 id, metric_key, metric_value, period_label, recorded_at, project_id
         FROM kpi_records
         WHERE env_id = @envId ${projectFilter} AND domain = 'DS' AND metric_key = @metricKey
         ORDER BY recorded_at DESC`,
        { ...kpiParams, metricKey: { type: sql.NVarChar(100), value: r.ds_field } }
      );

      // Get the most recent CA KPI for this field
      const latestCa = await query(
        `SELECT TOP 1 id, metric_key, metric_value, period_label, recorded_at, project_id
         FROM kpi_records
         WHERE env_id = @envId ${projectFilter} AND domain = 'CA' AND metric_key = @metricKey
         ORDER BY recorded_at DESC`,
        { ...kpiParams, metricKey: { type: sql.NVarChar(100), value: r.ca_field } }
      );

      if (!latestDs.recordset.length || !latestCa.recordset.length) continue;

      const ds = latestDs.recordset[0];
      const ca = latestCa.recordset[0];

      // Only compare KPIs from the same period if period labels exist on both
      if (ds.period_label && ca.period_label && ds.period_label !== ca.period_label) continue;

      const dsVal = Number(ds.metric_value);
      const caVal = Number(ca.metric_value);
      if (Number.isNaN(dsVal) || Number.isNaN(caVal)) continue;

      const delta = dsVal - caVal;
      const base = caVal === 0 ? 1 : Math.abs(caVal);
      const deltaPercent = (delta / base) * 100;

      // Only create conflict if variance exceeds threshold
      if (Math.abs(deltaPercent) <= Number(r.acceptable_variance_percent)) continue;

      // Use a resolved project ID for the conflict record
      const resolvedProjectId = projectId || ds.project_id || ca.project_id || null;

      // Check for existing unresolved conflicts to avoid duplicates
      const dedupeParams = {
        envId: { type: sql.UniqueIdentifier, value: envId },
        fieldName: { type: sql.NVarChar(120), value: r.ds_field },
        periodLabel: { type: sql.NVarChar(50), value: ds.period_label || null },
      };
      let dedupeQuery;
      if (resolvedProjectId) {
        dedupeQuery = `SELECT TOP 1 id FROM conflict_records
                       WHERE env_id = @envId AND project_id = @projectId AND field_name = @fieldName
                       AND (period_label = @periodLabel OR (@periodLabel IS NULL AND period_label IS NULL))
                       AND status IN ('OPEN', 'IN_RESOLUTION', 'ESCALATED')`;
        dedupeParams.projectId = { type: sql.UniqueIdentifier, value: resolvedProjectId };
      } else {
        dedupeQuery = `SELECT TOP 1 id FROM conflict_records
                       WHERE env_id = @envId AND project_id IS NULL AND field_name = @fieldName
                       AND (period_label = @periodLabel OR (@periodLabel IS NULL AND period_label IS NULL))
                       AND status IN ('OPEN', 'IN_RESOLUTION', 'ESCALATED')`;
      }
      const dedupe = await query(dedupeQuery, dedupeParams);
      if (dedupe.recordset.length) continue;

      // Create the conflict record
      const inserted = await query(
        `INSERT INTO conflict_records
           (id, env_id, project_id, conflict_rule_id, field_name, ds_value, ca_actual_value, delta, delta_percent, severity, period_label, status, created_at, updated_at)
         OUTPUT INSERTED.id
         VALUES
           (NEWID(), @envId, @resolvedProjectId, @ruleId, @fieldName, @dsValue, @caValue, @delta, @deltaPercent, @severity, @periodLabel, 'OPEN', GETUTCDATE(), GETUTCDATE())`,
        {
          envId: { type: sql.UniqueIdentifier, value: envId },
          resolvedProjectId: { type: sql.UniqueIdentifier, value: resolvedProjectId },
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
      created.push({ id: conflictId, fieldName: r.ds_field, dsValue: dsVal, caValue: caVal, deltaPercent, severity: r.severity });

      // Create constraint breach log for regulatory fields
      if (r.is_regulatory_field) {
        await query(
          `INSERT INTO constraint_breach_logs
            (id, env_id, project_id, field_name, severity, description, status, created_by, created_at)
           VALUES
            (NEWID(), @envId, @resolvedProjectId, @fieldName, @severity, @description, 'OPEN', NULL, GETUTCDATE())`,
          {
            envId: { type: sql.UniqueIdentifier, value: envId },
            resolvedProjectId: { type: sql.UniqueIdentifier, value: resolvedProjectId },
            fieldName: { type: sql.NVarChar(100), value: r.ds_field },
            severity: { type: sql.NVarChar(10), value: r.severity },
            description: { type: sql.NVarChar(sql.MAX), value: `Regulatory conflict detected for ${r.ds_field} (${Math.abs(deltaPercent).toFixed(2)}% variance). DS value: ${dsVal}, CA value: ${caVal}.` },
          }
        );
      }

      // Notify all project members (if project exists)
      if (resolvedProjectId) {
        const users = await query(
          `SELECT DISTINCT pm.user_id
           FROM project_members pm
           WHERE pm.project_id = @projectId AND pm.is_active = 1`,
          { projectId: { type: sql.UniqueIdentifier, value: resolvedProjectId } }
        );
        for (const u of users.recordset) {
          await notify({
            userId: u.user_id,
            type: 'conflict_detected',
            title: 'CA-DS Conflict Detected',
            body: `A conflict was detected for "${r.ds_field}" (${Math.abs(deltaPercent).toFixed(2)}% variance between DS: ${dsVal} and CA: ${caVal}).`,
            refId: conflictId,
            io,
          });
        }
      }

      // Emit via WebSocket
      if (io && resolvedProjectId) {
        io.to(`project:${resolvedProjectId}`).emit('conflicts_detected', {
          count: 1,
          conflict: { id: conflictId, fieldName: r.ds_field, dsValue: dsVal, caValue: caVal, deltaPercent, severity: r.severity },
        });
      }
    }

    if (created.length) {
      await auditLog({
        envId,
        actionType: 'conflicts_auto_detected',
        targetType: 'project',
        targetId: projectId,
        metadata: { count: created.length, conflicts: created },
      });
    }

    return created;
  } catch (err) {
    console.error('Conflict detection engine error:', err);
    return [];
  }
};

module.exports = { detectKpiConflicts };
