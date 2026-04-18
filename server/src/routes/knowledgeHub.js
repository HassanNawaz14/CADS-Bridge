const express = require('express');
const { body, validationResult, query: vQuery } = require('express-validator');
const { query, sql, transaction } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditLog } = require('../utils/auditLog');

const router = express.Router();

const validate = (vs) => async (req, res, next) => {
  await Promise.all(vs.map((v) => v.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
};

const isAdminRole = (role) => ['admin', 'platform_admin', 'super_admin'].includes(role);

router.use(authenticate);

// ── Glossary (3.6.1) ───────────────────────────────────────────────────────
router.get('/glossary', async (req, res) => {
  try {
    const { q, status } = req.query;
    const effectiveStatus = status || 'PUBLISHED';
    const canSeePending = isAdminRole(req.user.role);

    const where = ['gt.env_id = @envId'];
    const params = { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } };

    if (q?.trim()) {
      where.push('(gt.term LIKE @q OR gt.plain_english_description LIKE @q OR gt.ca_definition LIKE @q OR gt.ds_definition LIKE @q)');
      params.q = { type: sql.NVarChar, value: `%${q.trim()}%` };
    }

    if (effectiveStatus === 'PENDING') {
      if (!canSeePending) return res.status(403).json({ success: false, message: 'Access denied.' });
      where.push(`gt.status = 'PENDING'`);
    } else if (effectiveStatus === 'ALL') {
      if (!canSeePending) where.push(`gt.status = 'PUBLISHED'`);
    } else {
      where.push(`gt.status = 'PUBLISHED'`);
    }

    const result = await query(
      `SELECT gt.id, gt.term, gt.ca_definition, gt.ds_definition, gt.plain_english_description,
              gt.example_project_id, gt.status, gt.proposed_by, gt.approved_by, gt.created_at, gt.updated_at
       FROM glossary_terms gt
       WHERE ${where.join(' AND ')}
       ORDER BY gt.term ASC`,
      params
    );

    res.json({ success: true, terms: result.recordset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch glossary terms.' });
  }
});

router.post(
  '/glossary/propose',
  validate([
    body('term').trim().isLength({ min: 2, max: 120 }).withMessage('Term must be 2–120 characters.'),
    body('caDefinition').trim().isLength({ min: 2 }).withMessage('CA definition is required.'),
    body('dsDefinition').optional({ nullable: true }).isString(),
    body('plainEnglishDescription').trim().isLength({ min: 5 }).withMessage('Plain English description is required.'),
    body('exampleProjectId').optional({ nullable: true }).isUUID().withMessage('exampleProjectId must be a GUID.'),
  ]),
  async (req, res) => {
    try {
      const { term, caDefinition, dsDefinition, plainEnglishDescription, exampleProjectId } = req.body;

      const existing = await query(
        `SELECT TOP 1 id FROM glossary_terms WHERE env_id = @envId AND LOWER(term) = LOWER(@term)`,
        {
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          term: { type: sql.NVarChar, value: term.trim() },
        }
      );
      if (existing.recordset.length) {
        return res.status(400).json({ success: false, message: 'A glossary entry for this term already exists.' });
      }

      const id = require('uuid').v4();

      await query(
        `INSERT INTO glossary_terms (
           id, env_id, term, ca_definition, ds_definition, plain_english_description,
           example_project_id, status, proposed_by, approved_by, created_at, updated_at
         ) VALUES (
           @id, @envId, @term, @caDef, @dsDef, @plain, @examplePid, 'PENDING', @proposedBy, NULL, GETUTCDATE(), GETUTCDATE()
         )`,
        {
          id: { type: sql.UniqueIdentifier, value: id },
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          term: { type: sql.NVarChar, value: term.trim() },
          caDef: { type: sql.NVarChar(sql.MAX), value: caDefinition.trim() },
          dsDef: { type: sql.NVarChar(sql.MAX), value: dsDefinition?.trim?.() || null },
          plain: { type: sql.NVarChar(sql.MAX), value: plainEnglishDescription.trim() },
          examplePid: { type: sql.UniqueIdentifier, value: exampleProjectId || null },
          proposedBy: { type: sql.UniqueIdentifier, value: req.user.id },
        }
      );

      await auditLog({
        envId: req.user.env_id,
        actorId: req.user.id,
        actionType: 'glossary_term_proposed',
        targetType: 'glossary_term',
        targetId: id,
        targetName: term.trim(),
        ipAddress: req.ip,
      });

      res.status(201).json({ success: true, message: 'Term proposed for admin approval.', id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Failed to propose glossary term.' });
    }
  }
);

router.post(
  '/glossary/:id/publish',
  requireRole('admin', 'platform_admin', 'super_admin'),
  validate([
    body('term').optional().isString(),
    body('caDefinition').optional().isString(),
    body('dsDefinition').optional().isString(),
    body('plainEnglishDescription').optional().isString(),
    body('exampleProjectId').optional({ nullable: true }).isUUID(),
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { term, caDefinition, dsDefinition, plainEnglishDescription, exampleProjectId } = req.body || {};

      const existing = await query(
        `SELECT TOP 1 * FROM glossary_terms WHERE id = @id AND env_id = @envId`,
        { id: { type: sql.UniqueIdentifier, value: id }, envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
      );
      if (!existing.recordset.length) return res.status(404).json({ success: false, message: 'Term not found.' });

      const current = existing.recordset[0];
      const newTerm = term?.trim?.() || current.term;
      const caDef = caDefinition?.trim?.() || current.ca_definition;
      const dsDef = (dsDefinition?.trim?.() ?? current.ds_definition) || null;
      const plain = plainEnglishDescription?.trim?.() || current.plain_english_description;
      const examplePid = exampleProjectId === undefined ? current.example_project_id : (exampleProjectId || null);

      await query(
        `UPDATE glossary_terms
         SET term = @term,
             ca_definition = @caDef,
             ds_definition = @dsDef,
             plain_english_description = @plain,
             example_project_id = @examplePid,
             status = 'PUBLISHED',
             approved_by = @approvedBy,
             updated_at = GETUTCDATE()
         WHERE id = @id AND env_id = @envId`,
        {
          id: { type: sql.UniqueIdentifier, value: id },
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          term: { type: sql.NVarChar, value: newTerm },
          caDef: { type: sql.NVarChar(sql.MAX), value: caDef },
          dsDef: { type: sql.NVarChar(sql.MAX), value: dsDef },
          plain: { type: sql.NVarChar(sql.MAX), value: plain },
          examplePid: { type: sql.UniqueIdentifier, value: examplePid },
          approvedBy: { type: sql.UniqueIdentifier, value: req.user.id },
        }
      );

      await auditLog({
        envId: req.user.env_id,
        actorId: req.user.id,
        actionType: 'glossary_term_published',
        targetType: 'glossary_term',
        targetId: id,
        targetName: newTerm,
        ipAddress: req.ip,
      });

      res.json({ success: true, message: 'Glossary term published.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Failed to publish glossary term.' });
    }
  }
);

// ── Guidelines (3.6.3) ────────────────────────────────────────────────────
router.get('/guidelines', async (req, res) => {
  try {
    const { domain, projectType, q } = req.query;

    const where = ['g.env_id = @envId'];
    const params = { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } };

    if (domain?.trim()) {
      where.push('(g.domain = @domain OR g.domain = \'JOINT\')');
      params.domain = { type: sql.NVarChar, value: domain.trim().toUpperCase() };
    }
    if (projectType?.trim()) {
      where.push('(g.project_type = @projectType OR g.project_type IS NULL)');
      params.projectType = { type: sql.NVarChar, value: projectType.trim() };
    }
    if (q?.trim()) {
      where.push('(g.title LIKE @q OR gv.content LIKE @q)');
      params.q = { type: sql.NVarChar, value: `%${q.trim()}%` };
    }

    const result = await query(
      `SELECT g.id, g.title, g.domain, g.project_type, g.tags_json, g.created_by, g.created_at, g.updated_at,
              gv.version_number, gv.created_at as version_created_at
       FROM guidelines g
       OUTER APPLY (
         SELECT TOP 1 version_number, created_at, content
         FROM guideline_versions
         WHERE guideline_id = g.id
         ORDER BY version_number DESC
       ) gv
       WHERE ${where.join(' AND ')}
       ORDER BY g.updated_at DESC`,
      params
    );

    res.json({ success: true, guidelines: result.recordset.map((r) => ({ ...r, tags: safeJsonParse(r.tags_json) })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch guidelines.' });
  }
});

router.get('/guidelines/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const guideline = await query(
      `SELECT g.id, g.title, g.domain, g.project_type, g.tags_json, g.created_by, g.created_at, g.updated_at
       FROM guidelines g
       WHERE g.id = @id AND g.env_id = @envId`,
      { id: { type: sql.UniqueIdentifier, value: id }, envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
    );
    if (!guideline.recordset.length) return res.status(404).json({ success: false, message: 'Guideline not found.' });

    const versions = await query(
      `SELECT id, version_number, content, change_note, created_by, created_at
       FROM guideline_versions
       WHERE guideline_id = @id
       ORDER BY version_number DESC`,
      { id: { type: sql.UniqueIdentifier, value: id } }
    );

    const proposedEdits = isAdminRole(req.user.role)
      ? await query(
          `SELECT pe.id, pe.status, pe.comment, pe.proposed_content, pe.proposed_by, pe.reviewed_by, pe.reviewed_at, pe.created_at,
                  u.full_name as proposed_by_name
           FROM guideline_proposed_edits pe
           LEFT JOIN users u ON u.id = pe.proposed_by
           WHERE pe.guideline_id = @id
           ORDER BY pe.created_at DESC`,
          { id: { type: sql.UniqueIdentifier, value: id } }
        )
      : { recordset: [] };

    res.json({
      success: true,
      guideline: { ...guideline.recordset[0], tags: safeJsonParse(guideline.recordset[0].tags_json) },
      versions: versions.recordset,
      proposedEdits: proposedEdits.recordset,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch guideline.' });
  }
});

router.post(
  '/guidelines',
  requireRole('admin', 'platform_admin', 'super_admin'),
  validate([
    body('title').trim().isLength({ min: 3, max: 200 }).withMessage('Title must be 3–200 characters.'),
    body('domain').isIn(['CA', 'DS', 'JOINT']).withMessage('domain must be CA, DS, or JOINT.'),
    body('projectType').optional({ nullable: true }).isString(),
    body('tags').optional({ nullable: true }).isArray(),
    body('content').trim().isLength({ min: 20 }).withMessage('Content must be at least 20 characters.'),
    body('changeNote').optional({ nullable: true }).isString(),
  ]),
  async (req, res) => {
    try {
      const { title, domain, projectType, tags, content, changeNote } = req.body;
      const id = require('uuid').v4();

      await transaction(async (trx) => {
        await trx
          .request()
          .input('id', sql.UniqueIdentifier, id)
          .input('envId', sql.UniqueIdentifier, req.user.env_id)
          .input('title', sql.NVarChar, title.trim())
          .input('domain', sql.NVarChar, domain)
          .input('projectType', sql.NVarChar, projectType?.trim?.() || null)
          .input('tags', sql.NVarChar(sql.MAX), JSON.stringify(tags || []))
          .input('createdBy', sql.UniqueIdentifier, req.user.id)
          .query(
            `INSERT INTO guidelines (id, env_id, title, domain, project_type, tags_json, created_by, created_at, updated_at)
             VALUES (@id, @envId, @title, @domain, @projectType, @tags, @createdBy, GETUTCDATE(), GETUTCDATE())`
          );

        await trx
          .request()
          .input('id', sql.UniqueIdentifier, require('uuid').v4())
          .input('guidelineId', sql.UniqueIdentifier, id)
          .input('version', sql.Int, 1)
          .input('content', sql.NVarChar(sql.MAX), content)
          .input('note', sql.NVarChar(sql.MAX), changeNote?.trim?.() || 'Initial version')
          .input('createdBy', sql.UniqueIdentifier, req.user.id)
          .query(
            `INSERT INTO guideline_versions (id, guideline_id, version_number, content, change_note, created_by, created_at)
             VALUES (@id, @guidelineId, @version, @content, @note, @createdBy, GETUTCDATE())`
          );
      });

      await auditLog({
        envId: req.user.env_id,
        actorId: req.user.id,
        actionType: 'guideline_created',
        targetType: 'guideline',
        targetId: id,
        targetName: title.trim(),
        ipAddress: req.ip,
      });

      res.status(201).json({ success: true, id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Failed to create guideline.' });
    }
  }
);

router.post(
  '/guidelines/:id/propose-edit',
  validate([
    body('content').trim().isLength({ min: 20 }).withMessage('Proposed content must be at least 20 characters.'),
    body('comment').optional({ nullable: true }).isString(),
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { content, comment } = req.body;

      const g = await query(
        `SELECT TOP 1 id FROM guidelines WHERE id = @id AND env_id = @envId`,
        { id: { type: sql.UniqueIdentifier, value: id }, envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
      );
      if (!g.recordset.length) return res.status(404).json({ success: false, message: 'Guideline not found.' });

      const peId = require('uuid').v4();
      await query(
        `INSERT INTO guideline_proposed_edits (id, guideline_id, proposed_by, proposed_content, comment, status, created_at)
         VALUES (@id, @gid, @by, @content, @comment, 'PENDING', GETUTCDATE())`,
        {
          id: { type: sql.UniqueIdentifier, value: peId },
          gid: { type: sql.UniqueIdentifier, value: id },
          by: { type: sql.UniqueIdentifier, value: req.user.id },
          content: { type: sql.NVarChar(sql.MAX), value: content },
          comment: { type: sql.NVarChar(sql.MAX), value: comment?.trim?.() || null },
        }
      );

      await auditLog({
        envId: req.user.env_id,
        actorId: req.user.id,
        actionType: 'guideline_edit_proposed',
        targetType: 'guideline',
        targetId: id,
        targetName: id,
        metadata: { proposedEditId: peId },
        ipAddress: req.ip,
      });

      res.status(201).json({ success: true, id: peId });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Failed to propose edit.' });
    }
  }
);

router.post(
  '/guidelines/:id/proposed-edits/:editId/review',
  requireRole('admin', 'platform_admin', 'super_admin'),
  validate([
    body('decision').isIn(['APPROVE', 'REJECT']).withMessage('decision must be APPROVE or REJECT.'),
    body('changeNote').optional({ nullable: true }).isString(),
  ]),
  async (req, res) => {
    try {
      const { id, editId } = req.params;
      const { decision, changeNote } = req.body;

      const pe = await query(
        `SELECT TOP 1 * FROM guideline_proposed_edits WHERE id = @editId AND guideline_id = @gid`,
        { editId: { type: sql.UniqueIdentifier, value: editId }, gid: { type: sql.UniqueIdentifier, value: id } }
      );
      if (!pe.recordset.length) return res.status(404).json({ success: false, message: 'Proposed edit not found.' });
      const proposed = pe.recordset[0];
      if (proposed.status !== 'PENDING') {
        return res.status(400).json({ success: false, message: 'This proposed edit has already been reviewed.' });
      }

      if (decision === 'REJECT') {
        await query(
          `UPDATE guideline_proposed_edits
           SET status = 'REJECTED', reviewed_by = @by, reviewed_at = GETUTCDATE()
           WHERE id = @editId`,
          { editId: { type: sql.UniqueIdentifier, value: editId }, by: { type: sql.UniqueIdentifier, value: req.user.id } }
        );
        return res.json({ success: true, message: 'Proposed edit rejected.' });
      }

      // Approve: create new version
      await transaction(async (trx) => {
        const latest = await trx
          .request()
          .input('gid', sql.UniqueIdentifier, id)
          .query(`SELECT ISNULL(MAX(version_number), 0) as v FROM guideline_versions WHERE guideline_id = @gid`);
        const nextV = (latest.recordset[0]?.v || 0) + 1;

        await trx
          .request()
          .input('id', sql.UniqueIdentifier, require('uuid').v4())
          .input('gid', sql.UniqueIdentifier, id)
          .input('version', sql.Int, nextV)
          .input('content', sql.NVarChar(sql.MAX), proposed.proposed_content)
          .input('note', sql.NVarChar(sql.MAX), changeNote?.trim?.() || `Approved proposed edit ${editId}`)
          .input('by', sql.UniqueIdentifier, req.user.id)
          .query(
            `INSERT INTO guideline_versions (id, guideline_id, version_number, content, change_note, created_by, created_at)
             VALUES (@id, @gid, @version, @content, @note, @by, GETUTCDATE())`
          );

        await trx
          .request()
          .input('editId', sql.UniqueIdentifier, editId)
          .input('by', sql.UniqueIdentifier, req.user.id)
          .query(
            `UPDATE guideline_proposed_edits
             SET status = 'APPROVED', reviewed_by = @by, reviewed_at = GETUTCDATE()
             WHERE id = @editId`
          );

        await trx
          .request()
          .input('gid', sql.UniqueIdentifier, id)
          .query(`UPDATE guidelines SET updated_at = GETUTCDATE() WHERE id = @gid`);
      });

      await auditLog({
        envId: req.user.env_id,
        actorId: req.user.id,
        actionType: 'guideline_edit_approved',
        targetType: 'guideline',
        targetId: id,
        targetName: id,
        metadata: { proposedEditId: editId },
        ipAddress: req.ip,
      });

      res.json({ success: true, message: 'Proposed edit approved and published as new version.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Failed to review proposed edit.' });
    }
  }
);

// ── Past project library (3.6.2) ──────────────────────────────────────────
router.get('/library', async (req, res) => {
  try {
    const { domain, projectType, q, tag, dateFrom, dateTo, memberId } = req.query;
    const where = ['l.env_id = @envId'];
    const params = { envId: { type: sql.UniqueIdentifier, value: req.user.env_id } };

    if (domain?.trim()) {
      where.push('l.domain = @domain');
      params.domain = { type: sql.NVarChar, value: domain.trim().toUpperCase() };
    }
    if (projectType?.trim()) {
      where.push('l.project_type = @projectType');
      params.projectType = { type: sql.NVarChar, value: projectType.trim() };
    }
    if (q?.trim()) {
      where.push(`(
        p.name LIKE @q
        OR pf.original_name LIKE @q
        OR l.key_lessons LIKE @q
        OR EXISTS (
          SELECT 1
          FROM document_annotations da
          WHERE da.project_id = l.project_id
            AND da.body LIKE @q
        )
      )`);
      params.q = { type: sql.NVarChar, value: `%${q.trim()}%` };
    }
    if (dateFrom) {
      where.push('l.published_at >= @dateFrom');
      params.dateFrom = { type: sql.DateTime2, value: new Date(dateFrom) };
    }
    if (dateTo) {
      where.push('l.published_at <= @dateTo');
      params.dateTo = { type: sql.DateTime2, value: new Date(dateTo) };
    }
    if (memberId) {
      where.push(`EXISTS (
        SELECT 1
        FROM project_members pm
        WHERE pm.project_id = l.project_id
          AND pm.user_id = @memberId
          AND pm.is_active = 1
      )`);
      params.memberId = { type: sql.UniqueIdentifier, value: memberId };
    }

    const result = await query(
      `SELECT l.id, l.project_id, l.domain, l.project_type, l.tags_json, l.key_lessons, l.published_by, l.published_at,
              p.name as project_name, p.created_at as project_created_at,
              pf.id as file_id, pf.original_name as file_name,
              drd.document_path as decision_rationale_path
       FROM knowledge_hub_library l
       JOIN projects p ON p.id = l.project_id
       LEFT JOIN project_files pf ON pf.id = l.file_id
       LEFT JOIN decision_rationale_documents drd ON drd.id = l.decision_rationale_id
       WHERE ${where.join(' AND ')}
       ORDER BY l.published_at DESC`,
      params
    );

    const rows = result.recordset.map((r) => ({
      ...r,
      tags: safeJsonParse(r.tags_json),
    }));

    const filtered = tag?.trim()
      ? rows.filter((r) => (r.tags || []).some((t) => String(t).toLowerCase() === tag.trim().toLowerCase()))
      : rows;

    res.json({ success: true, entries: filtered });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch library entries.' });
  }
});

router.post(
  '/library/publish',
  requireRole('admin', 'platform_admin', 'super_admin'),
  validate([
    body('projectId').isUUID().withMessage('projectId must be a GUID.'),
    body('fileId').optional({ nullable: true }).isUUID(),
    body('decisionRationaleId').optional({ nullable: true }).isUUID(),
    body('domain').isIn(['CA', 'DS', 'JOINT']).withMessage('domain must be CA, DS, or JOINT.'),
    body('projectType').optional({ nullable: true }).isString(),
    body('tags').optional({ nullable: true }).isArray(),
    body('keyLessons').trim().isLength({ min: 5 }).withMessage('keyLessons is required (min 5 chars).'),
  ]),
  async (req, res) => {
    try {
      const { projectId, fileId, decisionRationaleId, domain, projectType, tags, keyLessons } = req.body;

      // Verify project exists in env and is completed
      const proj = await query(
        `SELECT TOP 1 id, name, status FROM projects WHERE id = @pid AND env_id = @envId`,
        { pid: { type: sql.UniqueIdentifier, value: projectId }, envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
      );
      if (!proj.recordset.length) return res.status(404).json({ success: false, message: 'Project not found.' });
      if (proj.recordset[0].status !== 'completed') {
        return res.status(400).json({ success: false, message: 'Only completed projects can be published to the Knowledge Hub.' });
      }

      // Verify referenced artifacts belong to project (if present)
      if (fileId) {
        const file = await query(
          `SELECT TOP 1 id FROM project_files WHERE id = @fid AND project_id = @pid`,
          { fid: { type: sql.UniqueIdentifier, value: fileId }, pid: { type: sql.UniqueIdentifier, value: projectId } }
        );
        if (!file.recordset.length) return res.status(400).json({ success: false, message: 'fileId does not belong to this project.' });
      }
      if (decisionRationaleId) {
        const drd = await query(
          `SELECT TOP 1 id FROM decision_rationale_documents WHERE id = @did AND project_id = @pid`,
          { did: { type: sql.UniqueIdentifier, value: decisionRationaleId }, pid: { type: sql.UniqueIdentifier, value: projectId } }
        );
        if (!drd.recordset.length) return res.status(400).json({ success: false, message: 'decisionRationaleId does not belong to this project.' });
      }

      const id = require('uuid').v4();
      await query(
        `INSERT INTO knowledge_hub_library (
           id, env_id, project_id, file_id, decision_rationale_id, domain, project_type, tags_json, key_lessons, published_by, published_at
         ) VALUES (
           @id, @envId, @pid, @fid, @drd, @domain, @ptype, @tags, @lessons, @by, GETUTCDATE()
         )`,
        {
          id: { type: sql.UniqueIdentifier, value: id },
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          pid: { type: sql.UniqueIdentifier, value: projectId },
          fid: { type: sql.UniqueIdentifier, value: fileId || null },
          drd: { type: sql.UniqueIdentifier, value: decisionRationaleId || null },
          domain: { type: sql.NVarChar, value: domain },
          ptype: { type: sql.NVarChar, value: projectType?.trim?.() || null },
          tags: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(tags || []) },
          lessons: { type: sql.NVarChar(sql.MAX), value: keyLessons.trim() },
          by: { type: sql.UniqueIdentifier, value: req.user.id },
        }
      );

      await auditLog({
        envId: req.user.env_id,
        actorId: req.user.id,
        actionType: 'knowledge_hub_library_published',
        targetType: 'knowledge_hub_entry',
        targetId: id,
        targetName: proj.recordset[0].name,
        metadata: { projectId, fileId, decisionRationaleId },
        ipAddress: req.ip,
      });

      res.status(201).json({ success: true, id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Failed to publish to Knowledge Hub.' });
    }
  }
);

router.get('/library/publish-options', requireRole('admin', 'platform_admin', 'super_admin'), async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ success: false, message: 'projectId is required.' });

    const proj = await query(
      `SELECT TOP 1 id FROM projects WHERE id = @pid AND env_id = @envId`,
      { pid: { type: sql.UniqueIdentifier, value: projectId }, envId: { type: sql.UniqueIdentifier, value: req.user.env_id } }
    );
    if (!proj.recordset.length) return res.status(404).json({ success: false, message: 'Project not found.' });

    const files = await query(
      `SELECT id, original_name, mime_type, uploaded_at
       FROM project_files
       WHERE project_id = @pid
       ORDER BY uploaded_at DESC`,
      { pid: { type: sql.UniqueIdentifier, value: projectId } }
    );

    const drd = await query(
      `SELECT id, document_path, generated_at, is_confidential
       FROM decision_rationale_documents
       WHERE project_id = @pid
       ORDER BY generated_at DESC`,
      { pid: { type: sql.UniqueIdentifier, value: projectId } }
    );

    res.json({ success: true, files: files.recordset, decisionRationales: drd.recordset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load publish options.' });
  }
});

function safeJsonParse(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

module.exports = router;

