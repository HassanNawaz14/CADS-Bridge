const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { query, sql } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditLog } = require('../utils/auditLog');
const { detectKpiConflicts } = require('../utils/conflictDetection');

router.use(authenticate);

const CA_DEFAULT_WIDGETS = ['revenue_variance', 'cost_accuracy', 'budget_utilisation', 'compliance_score'];
const DS_DEFAULT_WIDGETS = ['model_accuracy', 'f1_score', 'prediction_drift', 'pipeline_health', 'training_loss'];

const validate = (vs) => async (req, res, next) => {
  await Promise.all(vs.map((v) => v.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
};

router.get('/', async (req, res) => {
  try {
    const { projectId = null, teamView = 'false', memberId = null } = req.query;
    const isAdmin = ['admin', 'platform_admin', 'super_admin'].includes(req.user.role);
    const effectiveTeamView = isAdmin && teamView === 'true';

    const projectsResult = await query(
      `SELECT id, name, domain, status
       FROM projects
       WHERE env_id = @envId AND status IN ('active', 'pending', 'draft')
       ORDER BY created_at DESC`,
      { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
    );

    const layoutResult = await query(
      `SELECT layout_json
       FROM kpi_dashboard_layouts
       WHERE env_id = @envId AND user_id = @userId`,
      {
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        userId: { type: sql.UniqueIdentifier, value: req.user.id },
      }
    );

    const thresholdResult = await query(
      `SELECT metric_key, min_value, team
       FROM kpi_thresholds
       WHERE env_id = @envId`,
      { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
    );

    let kpiWhere = 'WHERE k.env_id = @envId';
    const kpiParams = {
      envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
    };

    if (projectId) {
      kpiWhere += ' AND k.project_id = @projectId';
      kpiParams.projectId = { type: sql.UniqueIdentifier, value: projectId };
    }
    if (!effectiveTeamView) {
      const targetUserId = memberId || req.user.id;
      kpiWhere += ' AND k.user_id = @targetUserId';
      kpiParams.targetUserId = { type: sql.UniqueIdentifier, value: targetUserId };
    }

    const kpiResult = await query(
      `SELECT k.id, k.user_id, k.project_id, k.metric_key, k.metric_value, k.unit, k.target_value, k.domain, k.source,
              k.period_label, k.period_start, k.period_end, k.recorded_at,
              u.full_name, u.team, u.avatar_initials
       FROM kpi_records k
       JOIN users u ON u.id = k.user_id
       ${kpiWhere}
       ORDER BY k.recorded_at DESC`,
      kpiParams
    );

    const insightsResult = projectId
      ? await query(
        `SELECT n.id, n.project_id, n.pair_key, n.period_label, n.note, n.created_at,
                u.full_name as author_name, u.team as author_team
         FROM kpi_insight_notes n
         JOIN users u ON u.id = n.author_id
         WHERE n.env_id = @envId AND n.project_id = @projectId
         ORDER BY n.created_at DESC`,
        {
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          projectId: { type: sql.UniqueIdentifier, value: projectId },
        }
      )
      : { recordset: [] };

    const performanceResult = await query(
      `SELECT u.id as user_id, u.full_name, u.team, u.avatar_initials,
        (
          (
            SELECT ISNULL(100.0 * SUM(CASE WHEN t.status = 'done' AND (t.due_date IS NULL OR t.completed_at <= DATEADD(day, 1, t.due_date)) THEN 1 ELSE 0 END)
                          / NULLIF(COUNT(*), 0), 0)
            FROM tasks t
            WHERE t.env_id = @envId AND t.assigned_to = u.id
          ) * 0.35
          +
          (
            SELECT ISNULL(100.0 * SUM(CASE WHEN k.target_value IS NOT NULL AND k.metric_value >= k.target_value THEN 1 ELSE 0 END)
                          / NULLIF(COUNT(*), 0), 0)
            FROM kpi_records k
            WHERE k.env_id = @envId AND k.user_id = u.id
          ) * 0.30
          +
          (
            SELECT ISNULL(AVG(CAST(r.rating AS FLOAT)) * 20, 60)
            FROM task_peer_ratings r
            WHERE r.env_id = @envId AND r.rated_user_id = u.id
          ) * 0.25
          +
          (
            SELECT CASE WHEN c.total_events >= 20 THEN 100 ELSE c.total_events * 5 END
            FROM (
              SELECT (
                (SELECT COUNT(*) FROM project_messages pm WHERE pm.sender_id = u.id)
                + (SELECT COUNT(*) FROM project_files pf WHERE pf.uploaded_by = u.id)
                + (SELECT COUNT(*) FROM tasks t2 WHERE t2.created_by = u.id)
              ) as total_events
            ) c
          ) * 0.10
        ) as performance_score
       FROM users u
       WHERE u.env_id = @envId AND u.status = 'active'
         AND (@teamView = 1 OR u.id = @userId)
       ORDER BY performance_score DESC`,
      {
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        teamView: { type: sql.Bit, value: effectiveTeamView ? 1 : 0 },
        userId: { type: sql.UniqueIdentifier, value: memberId || req.user.id },
      }
    );

    const recommendationsResult = await query(
      `SELECT r.id, r.user_id, r.recommendation_text, r.advancement_type, r.evidence_json, r.created_at,
              u.full_name as user_name, rb.full_name as recommended_by_name
       FROM advancement_recommendations r
       JOIN users u ON u.id = r.user_id
       JOIN users rb ON rb.id = r.recommended_by
       WHERE r.env_id = @envId
         AND (@teamView = 1 OR r.user_id = @userId)
       ORDER BY r.created_at DESC`,
      {
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        teamView: { type: sql.Bit, value: effectiveTeamView ? 1 : 0 },
        userId: { type: sql.UniqueIdentifier, value: memberId || req.user.id },
      }
    );

    const defaultLayout = {
      widgets: req.user.team === 'CA' ? CA_DEFAULT_WIDGETS : DS_DEFAULT_WIDGETS,
      sizes: {},
      order: req.user.team === 'CA' ? CA_DEFAULT_WIDGETS : DS_DEFAULT_WIDGETS,
    };

    res.json({
      success: true,
      projects: projectsResult.recordset,
      layout: layoutResult.recordset[0]?.layout_json ? JSON.parse(layoutResult.recordset[0].layout_json) : defaultLayout,
      thresholds: thresholdResult.recordset,
      kpi: kpiResult.recordset,
      insights: insightsResult.recordset,
      performance: performanceResult.recordset,
      recommendations: recommendationsResult.recordset,
      teamViewEnabled: effectiveTeamView,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'KPI data could not be loaded. Please try again later.' });
  }
});

router.post('/layout', validate([
  body('layout').isObject().withMessage('Layout object is required.'),
]), async (req, res) => {
  try {
    await query(
      `IF EXISTS (SELECT 1 FROM kpi_dashboard_layouts WHERE env_id = @envId AND user_id = @userId)
       BEGIN
         UPDATE kpi_dashboard_layouts SET layout_json = @layout, updated_at = GETUTCDATE()
         WHERE env_id = @envId AND user_id = @userId
       END
       ELSE
       BEGIN
         INSERT INTO kpi_dashboard_layouts (id, env_id, user_id, layout_json)
         VALUES (NEWID(), @envId, @userId, @layout)
       END`,
      {
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        userId: { type: sql.UniqueIdentifier, value: req.user.id },
        layout: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(req.body.layout) },
      }
    );

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'kpi_layout_updated',
      targetType: 'kpi',
      metadata: { widgetCount: (req.body.layout.widgets || []).length },
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'Layout updated.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update layout.' });
  }
});

router.post('/', validate([
  body('metricKey').trim().isLength({ min: 2 }).withMessage('Metric key is required.'),
  body('metricValue').isFloat().withMessage('Metric value must be numeric.'),
  body('domain').isIn(['CA', 'DS']).withMessage('Domain must be CA or DS.'),
  body('source').isIn(['MANUAL', 'AUTO_INGESTED']).withMessage('Invalid source.'),
]), async (req, res) => {
  try {
    const {
      userId,
      projectId = null,
      metricKey,
      metricValue,
      unit = '%',
      targetValue = null,
      domain,
      source,
      periodLabel = null,
      periodStart = null,
      periodEnd = null,
    } = req.body;

    const targetUserId = userId || req.user.id;
    const now = new Date();
    const safePeriodStart = periodStart ? new Date(periodStart) : new Date(now.getFullYear(), now.getMonth(), 1);
    const safePeriodEnd = periodEnd ? new Date(periodEnd) : new Date(now.getFullYear(), now.getMonth() + 1, 0);

    await query(
      `INSERT INTO kpi_records (
        id, env_id, user_id, project_id, metric_key, metric_value, unit, target_value, domain, source, period_label, period_start, period_end
      )
       VALUES (
        NEWID(), @envId, @userId, @projectId, @metricKey, @metricValue, @unit, @targetValue, @domain, @source, @periodLabel, @periodStart, @periodEnd
      )`,
      {
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        userId: { type: sql.UniqueIdentifier, value: targetUserId },
        projectId: { type: sql.UniqueIdentifier, value: projectId },
        metricKey: { type: sql.NVarChar(100), value: metricKey },
        metricValue: { type: sql.Decimal(10, 4), value: parseFloat(metricValue) },
        unit: { type: sql.NVarChar(20), value: unit },
        targetValue: { type: sql.Decimal(10, 4), value: targetValue !== null ? parseFloat(targetValue) : null },
        domain: { type: sql.NVarChar(10), value: domain },
        source: { type: sql.NVarChar(20), value: source },
        periodLabel: { type: sql.NVarChar(50), value: periodLabel },
        periodStart: { type: sql.Date, value: safePeriodStart },
        periodEnd: { type: sql.Date, value: safePeriodEnd },
      }
    );

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'kpi_recorded',
      targetType: 'user',
      targetId: targetUserId,
      metadata: { metricKey, metricValue, source, projectId },
      ipAddress: req.ip,
    });

    const createdConflicts = await detectKpiConflicts({
      envId: req.user.env_id,
      projectId: projectId || null,
      io: req.app.get('io'),
    });

    res.status(201).json({
      success: true,
      message: 'KPI recorded.',
      conflictsCreated: createdConflicts.length,
      conflicts: createdConflicts,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to record KPI.' });
  }
});

router.post('/insights', validate([
  body('projectId').isUUID().withMessage('Project ID is required.'),
  body('pairKey').optional({ nullable: true }).trim(),
  body('note').trim().isLength({ min: 1 }).withMessage('Insight note is required.'),
]), async (req, res) => {
  try {
    const { projectId, pairKey, periodLabel = null, note } = req.body;
    const safePairKey = (pairKey && pairKey.trim()) ? pairKey.trim() : 'general_cross_domain_insight';
    await query(
      `INSERT INTO kpi_insight_notes (id, env_id, project_id, pair_key, period_label, note, author_id)
       VALUES (NEWID(), @envId, @projectId, @pairKey, @periodLabel, @note, @authorId)`,
      {
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        projectId: { type: sql.UniqueIdentifier, value: projectId },
        pairKey: { type: sql.NVarChar(200), value: safePairKey },
        periodLabel: { type: sql.NVarChar(50), value: periodLabel },
        note: { type: sql.NVarChar(sql.MAX), value: note },
        authorId: { type: sql.UniqueIdentifier, value: req.user.id },
      }
    );

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'kpi_insight_added',
      targetType: 'project',
      targetId: projectId,
      metadata: { pairKey: safePairKey, periodLabel },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, message: 'Insight note added.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to add insight note.' });
  }
});

router.post('/peer-rating', validate([
  body('taskId').isUUID().withMessage('Task ID is required.'),
  body('ratedUserId').isUUID().withMessage('Rated user is required.'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1 to 5.'),
]), async (req, res) => {
  try {
    const { taskId, ratedUserId, rating, note = null } = req.body;
    await query(
      `INSERT INTO task_peer_ratings (id, env_id, task_id, rater_id, rated_user_id, rating, note)
       VALUES (NEWID(), @envId, @taskId, @raterId, @ratedUserId, @rating, @note)`,
      {
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        taskId: { type: sql.UniqueIdentifier, value: taskId },
        raterId: { type: sql.UniqueIdentifier, value: req.user.id },
        ratedUserId: { type: sql.UniqueIdentifier, value: ratedUserId },
        rating: { type: sql.Int, value: rating },
        note: { type: sql.NVarChar(1000), value: note },
      }
    );

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'peer_rating_added',
      targetType: 'user',
      targetId: ratedUserId,
      metadata: { taskId, rating },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, message: 'Peer rating saved.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save peer rating.' });
  }
});

router.post('/recommendations', requireRole('admin', 'platform_admin', 'super_admin'), validate([
  body('userId').isUUID().withMessage('User ID is required.'),
  body('recommendationText').trim().isLength({ min: 3 }).withMessage('Recommendation text is required.'),
  body('advancementType').trim().isLength({ min: 3 }).withMessage('Advancement type is required.'),
]), async (req, res) => {
  try {
    const { userId, recommendationText, evidence = [], advancementType } = req.body;
    await query(
      `INSERT INTO advancement_recommendations (
        id, env_id, user_id, recommended_by, recommendation_text, evidence_json, advancement_type
      )
       VALUES (
        NEWID(), @envId, @userId, @recommendedBy, @recommendationText, @evidence, @advancementType
      )`,
      {
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        userId: { type: sql.UniqueIdentifier, value: userId },
        recommendedBy: { type: sql.UniqueIdentifier, value: req.user.id },
        recommendationText: { type: sql.NVarChar(sql.MAX), value: recommendationText },
        evidence: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(evidence) },
        advancementType: { type: sql.NVarChar(100), value: advancementType },
      }
    );

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'advancement_recommendation_created',
      targetType: 'user',
      targetId: userId,
      metadata: { advancementType, evidenceCount: evidence.length },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, message: 'Recommendation saved.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save recommendation.' });
  }
});

module.exports = router;
