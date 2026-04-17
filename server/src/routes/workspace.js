const express = require('express');
const router = express.Router({ mergeParams: true });
const path = require('path');
const { query, sql } = require('../db');
const { authenticate } = require('../middleware/auth');
const { handleUpload } = require('../middleware/upload');
const { auditLog } = require('../utils/auditLog');

router.use(authenticate);

// Guard: user must be a member of this project
const requireMembership = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT pm.id FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       WHERE pm.project_id = @pid AND pm.user_id = @uid AND pm.is_active = 1
         AND p.env_id = @envId AND p.status = 'active'`,
      {
        pid:   { type: sql.UniqueIdentifier, value: req.params.projectId },
        uid:   { type: sql.UniqueIdentifier, value: req.user.id },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );
    if (!result.recordset.length) {
      return res.status(403).json({ success: false, message: 'You no longer have access to this project.' });
    }
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: 'Membership check failed.' });
  }
};

router.use(requireMembership);

const compareRule = (operator, value, threshold) => {
  if (operator === 'GT') return value > threshold;
  if (operator === 'LT') return value < threshold;
  if (operator === 'EQ') return value === threshold;
  if (operator === 'NEQ') return value !== threshold;
  return false;
};

const nextVersion = (version) => {
  const [major, minor] = String(version || '1.0').split('.').map((n) => parseInt(n, 10) || 0);
  return `${major}.${minor + 1}`;
};

// ── GET /api/projects/:projectId/messages ─────────────────────────────────
router.get('/messages', async (req, res) => {
  try {
    const result = await query(
      `SELECT pm.id, pm.content, pm.sent_at,
              u.id as sender_id, u.full_name, u.team, u.avatar_initials
       FROM project_messages pm
       JOIN users u ON u.id = pm.sender_id
       WHERE pm.project_id = @pid
       ORDER BY pm.sent_at ASC`,
      { pid: { type: sql.UniqueIdentifier, value: req.params.projectId } }
    );
    res.json({ success: true, messages: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch messages.' });
  }
});

// ── POST /api/projects/:projectId/messages ────────────────────────────────
router.post('/messages', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) {
      return res.status(400).json({ success: false, message: 'Message content is required.' });
    }

    const result = await query(
      `INSERT INTO project_messages (id, project_id, sender_id, content)
       OUTPUT INSERTED.id, INSERTED.content, INSERTED.sent_at
       VALUES (NEWID(), @pid, @uid, @content)`,
      {
        pid:     { type: sql.UniqueIdentifier, value: req.params.projectId },
        uid:     { type: sql.UniqueIdentifier, value: req.user.id },
        content: { type: sql.NVarChar(sql.MAX), value: content.trim() },
      }
    );

    const message = {
      ...result.recordset[0],
      sender_id:      req.user.id,
      full_name:      req.user.full_name,
      team:           req.user.team,
      avatar_initials: req.user.avatar_initials,
    };

    // Broadcast via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`project:${req.params.projectId}`).emit('new_message', message);
    }

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'message_sent',
      targetType: 'project',
      targetId: req.params.projectId,
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, message });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
});

// ── GET /api/projects/:projectId/files ────────────────────────────────────
router.get('/files', async (req, res) => {
  try {
    const result = await query(
      `SELECT pf.id, pf.original_name, pf.file_size, pf.mime_type, pf.uploaded_at,
              u.full_name as uploaded_by_name, u.team as uploaded_by_team
       FROM project_files pf
       JOIN users u ON u.id = pf.uploaded_by
       WHERE pf.project_id = @pid
       ORDER BY pf.uploaded_at DESC`,
      { pid: { type: sql.UniqueIdentifier, value: req.params.projectId } }
    );
    res.json({ success: true, files: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch files.' });
  }
});

// ── POST /api/projects/:projectId/files ───────────────────────────────────
router.post('/files', handleUpload('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
    const { outputType = null, changeNote = null, versionNumber = null, publish = false, dataSnapshot = null, fileId = null } = req.body;

    if (publish && (!changeNote || String(changeNote).trim().length < 10)) {
      return res.status(400).json({ success: false, message: 'changeNote is required (min 10 chars) for publishing.' });
    }

    let documentId = fileId;
    let currentVersion = '1.0';
    if (documentId) {
      const existing = await query(
        `SELECT id FROM project_files WHERE id = @id AND project_id = @pid`,
        {
          id: { type: sql.UniqueIdentifier, value: documentId },
          pid: { type: sql.UniqueIdentifier, value: req.params.projectId },
        }
      );
      if (!existing.recordset.length) {
        return res.status(404).json({ success: false, message: 'Base document for new version not found.' });
      }
      const lastVersion = await query(
        `SELECT TOP 1 version_number
         FROM project_file_versions
         WHERE file_id = @fileId
         ORDER BY published_at DESC`,
        { fileId: { type: sql.UniqueIdentifier, value: documentId } }
      );
      currentVersion = nextVersion(lastVersion.recordset[0]?.version_number || '1.0');
    } else {
      const result = await query(
        `INSERT INTO project_files (id, project_id, uploaded_by, file_name, original_name, file_size, mime_type, file_path)
         OUTPUT INSERTED.id, INSERTED.original_name, INSERTED.file_size, INSERTED.mime_type, INSERTED.uploaded_at
         VALUES (NEWID(), @pid, @uid, @fname, @oname, @size, @mime, @fpath)`,
        {
          pid:   { type: sql.UniqueIdentifier, value: req.params.projectId },
          uid:   { type: sql.UniqueIdentifier, value: req.user.id },
          fname: { type: sql.NVarChar, value: req.file.filename },
          oname: { type: sql.NVarChar, value: req.file.originalname },
          size:  { type: sql.BigInt, value: req.file.size },
          mime:  { type: sql.NVarChar, value: req.file.mimetype },
          fpath: { type: sql.NVarChar, value: req.file.path },
        }
      );
      documentId = result.recordset[0].id;
    }

    const effectiveVersion = versionNumber || currentVersion;
    const versionInsert = await query(
      `INSERT INTO project_file_versions (id, file_id, version_number, output_type, change_note, file_path, file_size, mime_type, published_by)
       OUTPUT INSERTED.id, INSERTED.version_number, INSERTED.output_type, INSERTED.change_note, INSERTED.published_at
       VALUES (NEWID(), @fileId, @versionNumber, @outputType, @changeNote, @filePath, @fileSize, @mimeType, @publishedBy)`,
      {
        fileId: { type: sql.UniqueIdentifier, value: documentId },
        versionNumber: { type: sql.NVarChar(20), value: effectiveVersion },
        outputType: { type: sql.NVarChar(30), value: outputType },
        changeNote: { type: sql.NVarChar(sql.MAX), value: changeNote },
        filePath: { type: sql.NVarChar(500), value: req.file.path },
        fileSize: { type: sql.BigInt, value: req.file.size },
        mimeType: { type: sql.NVarChar(100), value: req.file.mimetype },
        publishedBy: { type: sql.UniqueIdentifier, value: req.user.id },
      }
    );

    let violations = [];
    if (publish && dataSnapshot) {
      const rules = await query(
        `SELECT id, field_name, operator, threshold_value, severity, description, regulatory_reference
         FROM regulatory_rules
         WHERE env_id = @envId AND (project_id IS NULL OR project_id = @projectId)`,
        {
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
        }
      );
      const snapshot = typeof dataSnapshot === 'string' ? JSON.parse(dataSnapshot) : dataSnapshot;
      for (const rule of rules.recordset) {
        const val = snapshot?.[rule.field_name];
        if (val === undefined || val === null || Number.isNaN(Number(val))) continue;
        if (compareRule(rule.operator, Number(val), Number(rule.threshold_value))) {
          violations.push({
            ruleId: rule.id,
            fieldName: rule.field_name,
            value: Number(val),
            threshold: Number(rule.threshold_value),
            severity: rule.severity,
            description: rule.description,
            regulatoryReference: rule.regulatory_reference,
          });
        }
      }

      for (const v of violations) {
        await query(
          `INSERT INTO constraint_breach_logs
            (id, env_id, project_id, file_id, version_id, field_name, severity, description, regulatory_reference, created_by)
           VALUES
            (NEWID(), @envId, @projectId, @fileId, @versionId, @fieldName, @severity, @description, @reference, @createdBy)`,
          {
            envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
            projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
            fileId: { type: sql.UniqueIdentifier, value: documentId },
            versionId: { type: sql.UniqueIdentifier, value: versionInsert.recordset[0].id },
            fieldName: { type: sql.NVarChar(100), value: v.fieldName },
            severity: { type: sql.NVarChar(10), value: v.severity },
            description: { type: sql.NVarChar(sql.MAX), value: `Auto rule breach: ${v.description}. Value=${v.value}, Threshold=${v.threshold}` },
            reference: { type: sql.NVarChar(255), value: v.regulatoryReference },
            createdBy: { type: sql.UniqueIdentifier, value: req.user.id },
          }
        );
      }
    }

    const file = {
      id: documentId,
      original_name: req.file.originalname,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      uploaded_at: new Date().toISOString(),
      uploaded_by_name: req.user.full_name,
      uploaded_by_team: req.user.team,
      latest_version: effectiveVersion,
      publish_violations: violations,
    };

    const io = req.app.get('io');
    if (io) {
      io.to(`project:${req.params.projectId}`).emit('new_file', file);
    }

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'file_upload',
      targetType: 'file',
      targetId: documentId,
      targetName: req.file.originalname,
      metadata: { projectId: req.params.projectId, size: req.file.size, versionNumber: effectiveVersion, outputType, violations: violations.length },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, file });
  } catch (err) {
    res.status(500).json({ success: false, message: 'File upload failed.' });
  }
});

router.get('/files/:fileId/versions', async (req, res) => {
  try {
    const versions = await query(
      `SELECT v.id, v.version_number, v.output_type, v.change_note, v.file_size, v.mime_type, v.file_path, v.published_at,
              u.full_name as published_by_name
       FROM project_file_versions v
       JOIN users u ON u.id = v.published_by
       WHERE v.file_id = @fileId
       ORDER BY v.published_at DESC`,
      { fileId: { type: sql.UniqueIdentifier, value: req.params.fileId } }
    );
    res.json({ success: true, versions: versions.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch version history.' });
  }
});

router.post('/files/:fileId/restore', async (req, res) => {
  try {
    const { versionId } = req.body;
    const oldVersion = await query(
      `SELECT * FROM project_file_versions WHERE id = @versionId AND file_id = @fileId`,
      {
        versionId: { type: sql.UniqueIdentifier, value: versionId },
        fileId: { type: sql.UniqueIdentifier, value: req.params.fileId },
      }
    );
    if (!oldVersion.recordset.length) return res.status(404).json({ success: false, message: 'Version not found.' });
    const latest = await query(
      `SELECT TOP 1 version_number FROM project_file_versions WHERE file_id = @fileId ORDER BY published_at DESC`,
      { fileId: { type: sql.UniqueIdentifier, value: req.params.fileId } }
    );
    const restoredVersion = nextVersion(latest.recordset[0]?.version_number || '1.0');
    await query(
      `INSERT INTO project_file_versions (id, file_id, version_number, output_type, change_note, file_path, file_size, mime_type, published_by)
       VALUES (NEWID(), @fileId, @version, @outputType, @note, @path, @size, @mime, @uid)`,
      {
        fileId: { type: sql.UniqueIdentifier, value: req.params.fileId },
        version: { type: sql.NVarChar(20), value: restoredVersion },
        outputType: { type: sql.NVarChar(30), value: oldVersion.recordset[0].output_type },
        note: { type: sql.NVarChar(sql.MAX), value: `Restored from v${oldVersion.recordset[0].version_number}` },
        path: { type: sql.NVarChar(500), value: oldVersion.recordset[0].file_path },
        size: { type: sql.BigInt, value: oldVersion.recordset[0].file_size },
        mime: { type: sql.NVarChar(100), value: oldVersion.recordset[0].mime_type },
        uid: { type: sql.UniqueIdentifier, value: req.user.id },
      }
    );
    res.json({ success: true, message: `Version restored as ${restoredVersion}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to restore version.' });
  }
});

router.get('/breaches', async (req, res) => {
  try {
    const logs = await query(
      `SELECT b.id, b.project_id, b.file_id, b.version_id, b.field_name, b.severity, b.description, b.regulatory_reference,
              b.status, b.resolution_plan, b.created_at, p.name as project_name, u.full_name as created_by_name
       FROM constraint_breach_logs b
       JOIN projects p ON p.id = b.project_id
       LEFT JOIN users u ON u.id = b.created_by
       WHERE b.env_id = @envId AND b.project_id = @projectId
       ORDER BY b.created_at DESC`,
      {
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
      }
    );
    res.json({ success: true, breaches: logs.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch breach log.' });
  }
});

router.post('/breaches', async (req, res) => {
  try {
    const { fileId = null, versionId = null, fieldName = null, severity = 'MEDIUM', description, regulatoryReference = null } = req.body;
    if (!description?.trim()) return res.status(400).json({ success: false, message: 'Description is required.' });
    await query(
      `INSERT INTO constraint_breach_logs
        (id, env_id, project_id, file_id, version_id, field_name, severity, description, regulatory_reference, created_by)
       VALUES
        (NEWID(), @envId, @projectId, @fileId, @versionId, @fieldName, @severity, @description, @regRef, @createdBy)`,
      {
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
        fileId: { type: sql.UniqueIdentifier, value: fileId },
        versionId: { type: sql.UniqueIdentifier, value: versionId },
        fieldName: { type: sql.NVarChar(100), value: fieldName },
        severity: { type: sql.NVarChar(10), value: severity },
        description: { type: sql.NVarChar(sql.MAX), value: description.trim() },
        regRef: { type: sql.NVarChar(255), value: regulatoryReference },
        createdBy: { type: sql.UniqueIdentifier, value: req.user.id },
      }
    );
    res.status(201).json({ success: true, message: 'Constraint breach logged.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to log breach.' });
  }
});

router.patch('/breaches/:breachId/resolve', async (req, res) => {
  try {
    const { breachId } = req.params;
    const { resolutionPlan, correctiveVersionId } = req.body;
    if (!correctiveVersionId) {
      return res.status(400).json({ success: false, message: 'Corrective output version is required to resolve a breach.' });
    }
    await query(
      `UPDATE constraint_breach_logs
       SET status = 'RESOLVED',
           resolution_plan = @resolutionPlan,
           corrective_version_id = @correctiveVersionId,
           resolved_by = @resolvedBy,
           resolved_at = GETUTCDATE()
       WHERE id = @breachId AND project_id = @projectId AND env_id = @envId`,
      {
        breachId: { type: sql.UniqueIdentifier, value: breachId },
        projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        resolutionPlan: { type: sql.NVarChar(sql.MAX), value: resolutionPlan || null },
        correctiveVersionId: { type: sql.UniqueIdentifier, value: correctiveVersionId },
        resolvedBy: { type: sql.UniqueIdentifier, value: req.user.id },
      }
    );
    res.json({ success: true, message: 'Breach resolved.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to resolve breach.' });
  }
});

// ── GET /api/projects/:projectId/files/:fileId/download ───────────────────
router.get('/files/:fileId/download', async (req, res) => {
  try {
    const result = await query(
      `SELECT file_path, original_name, mime_type FROM project_files
       WHERE id = @fid AND project_id = @pid`,
      {
        fid: { type: sql.UniqueIdentifier, value: req.params.fileId },
        pid: { type: sql.UniqueIdentifier, value: req.params.projectId },
      }
    );
    if (!result.recordset.length) return res.status(404).json({ success: false, message: 'File not found.' });

    const file = result.recordset[0];
    
    // Support Cloudinary URL redirect or legacy local file downloads
    if (file.file_path.startsWith('http')) {
      res.redirect(file.file_path);
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
      res.setHeader('Content-Type', file.mime_type);
      res.sendFile(path.resolve(file.file_path));
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Download failed.' });
  }
});

module.exports = router;
