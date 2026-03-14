const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { query, sql } = require('../db');
const { authenticate } = require('../middleware/auth');
const { auditLog } = require('../utils/auditLog');

router.use(authenticate);

// ── GET /api/kpi  — full KPI dashboard data ───────────────────────────────
router.get('/', async (req, res) => {
  try {
    // Fetch latest KPI record per user per metric
    const kpiResult = await query(
      `SELECT k.user_id, k.metric_key, k.metric_value, k.period_start, k.period_end, k.recorded_at,
              u.full_name, u.team, u.designation, u.avatar_initials,
              t.min_value as threshold
       FROM kpi_records k
       JOIN users u ON u.id = k.user_id
       LEFT JOIN kpi_thresholds t ON t.env_id = k.env_id AND t.metric_key = k.metric_key AND t.team = u.team
       WHERE k.env_id = @envId
         AND k.recorded_at = (
           SELECT MAX(k2.recorded_at) FROM kpi_records k2
           WHERE k2.user_id = k.user_id AND k2.metric_key = k.metric_key
         )
       ORDER BY u.team, u.full_name`,
      { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
    );

    // Fetch thresholds for this env
    const thresholds = await query(
      `SELECT metric_key, min_value, team FROM kpi_thresholds WHERE env_id = @envId`,
      { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
    );

    // Cross-domain: collaboration score = active projects with both teams
    const collabResult = await query(
      `SELECT COUNT(DISTINCT p.id) as active_projects,
              (SELECT COUNT(*) FROM projects WHERE env_id = @envId AND status = 'completed') as completed_projects,
              (SELECT COUNT(*) FROM projects WHERE env_id = @envId) as total_projects
       FROM projects p
       WHERE p.env_id = @envId AND p.status = 'active'`,
      { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
    );

    res.json({
      success: true,
      kpi: kpiResult.recordset,
      thresholds: thresholds.recordset,
      collaboration: collabResult.recordset[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'KPI data could not be loaded. Please try again later.' });
  }
});

// ── POST /api/kpi  — record a KPI entry (admin or system) ─────────────────
router.post('/', async (req, res) => {
  try {
    const { userId, metricKey, metricValue, periodStart, periodEnd } = req.body;

    await query(
      `INSERT INTO kpi_records (id, env_id, user_id, metric_key, metric_value, period_start, period_end)
       VALUES (NEWID(), @envId, @userId, @key, @val, @start, @end)`,
      {
        envId:  { type: sql.UniqueIdentifier, value: req.user.env_id },
        userId: { type: sql.UniqueIdentifier, value: userId },
        key:    { type: sql.NVarChar(100), value: metricKey },
        val:    { type: sql.Decimal(10, 4), value: parseFloat(metricValue) },
        start:  { type: sql.Date, value: new Date(periodStart) },
        end:    { type: sql.Date, value: new Date(periodEnd) },
      }
    );

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'kpi_recorded',
      targetType: 'user',
      targetId: userId,
      metadata: { metricKey, metricValue },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, message: 'KPI recorded.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to record KPI.' });
  }
});

module.exports = router;
