const express = require('express');
const router = express.Router({ mergeParams: true });
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const { query, sql } = require('../db');
const { authenticate } = require('../middleware/auth');
const { handleUpload } = require('../middleware/upload');
const { auditLog } = require('../utils/auditLog');
const { notify } = require('../utils/notify');

router.use(authenticate);

// Guard: user must be a member of this project
const requireMembership = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT pm.id FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       WHERE pm.project_id = @pid AND pm.user_id = @uid AND pm.is_active = 1
         AND p.env_id = @envId AND LOWER(p.status) = 'active'`,
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

// ── GET /api/projects/:projectId/members ─────────────────────────────────
router.get('/members', async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.full_name, u.team, u.avatar_initials, u.role,
              pm.workspace_role,
              (
                SELECT COUNT(*) FROM tasks t
                WHERE t.assigned_to = u.id AND t.project_id = @pid AND t.status != 'done'
              ) as pending_tasks
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = @pid AND pm.is_active = 1
       ORDER BY u.team, u.full_name`,
      { pid: { type: sql.UniqueIdentifier, value: req.params.projectId } }
    );
    res.json({ success: true, members: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch members.' });
  }
});

// ── GET /api/projects/:projectId/activity ─────────────────────────────────
router.get('/activity', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const result = await query(
      `SELECT TOP (@limit) al.id, al.action_type, al.target_type, al.target_name, al.metadata, al.created_at,
              u.full_name as actor_name, u.team as actor_team
       FROM audit_logs al
       JOIN users u ON u.id = al.actor_id
       WHERE al.project_id = @pid AND al.env_id = @envId
       ORDER BY al.created_at DESC`,
      {
        limit: { type: sql.Int, value: parseInt(limit) },
        pid: { type: sql.UniqueIdentifier, value: req.params.projectId },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      }
    );
    res.json({ success: true, activities: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch activity feed.' });
  }
});

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
      projectId: req.params.projectId,
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
              pf.domain, pf.file_type, pf.is_locked, pf.locked_by, pf.lock_expires_at,
              u.full_name as uploaded_by_name, u.team as uploaded_by_team,
              lu.full_name as locked_by_name
       FROM project_files pf
       JOIN users u ON u.id = pf.uploaded_by
       LEFT JOIN users lu ON lu.id = pf.locked_by
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
    const { domain = 'JOINT', fileType = 'OTHER', changeNote = null, versionNumber = null, publish: rawPublish = 'false', dataSnapshot = null, fileId = null } = req.body;
    // FormData sends all values as strings — "false" is truthy in JS, so parse explicitly
    const publish = rawPublish === true || rawPublish === 'true';

    if (publish && (!changeNote || String(changeNote).trim().length < 10)) {
      return res.status(400).json({ success: false, message: 'changeNote is required (min 10 chars) for publishing.' });
    }

    let violations = [];
    let precheckResult = { passed: true, skipped: false };
    if (publish) {
      if (!dataSnapshot) {
        precheckResult.skipped = true;
      } else {
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
        await auditLog({
          envId: req.user.env_id,
          actorId: req.user.id,
          actionType: 'regulatory_precheck_run',
          targetType: 'project',
          targetId: req.params.projectId,
          projectId: req.params.projectId,
          metadata: { passed: violations.length === 0, violations: violations.length },
          ipAddress: req.ip,
        });
        if (violations.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Publication blocked by regulatory pre-check.',
            precheck: { passed: false, violations },
          });
        }
      }
    }

    let documentId = fileId;
    let currentVersion = '1.0';
    let fileContent = null;

    // Detect if this is a text-based file we should index for inline editing/annotation
    const isText = req.file.mimetype.startsWith('text/') || 
                   req.file.mimetype === 'application/json' || 
                   req.file.originalname.endsWith('.csv') ||
                   req.file.originalname.endsWith('.txt') ||
                   req.file.originalname.endsWith('.md');

    if (isText) {
      try {
        let fetchUrl = req.file.path;
        // Fix for Windows mangling https:// into C:\...\https:\...
        if (fetchUrl.includes('http') && !fetchUrl.startsWith('http')) {
          const startIdx = fetchUrl.indexOf('http');
          fetchUrl = fetchUrl.substring(startIdx).replace(/\\/g, '/');
          // Fix double slash after protocol if mangled
          if (fetchUrl.includes(':/') && !fetchUrl.includes('://')) {
            fetchUrl = fetchUrl.replace(':/', '://');
          }
        }

        if (fetchUrl.startsWith('http')) {
          const response = await axios.get(fetchUrl, { 
            responseType: 'text',
            timeout: 10000,
            headers: { 'Accept': 'text/plain, application/json, */*' }
          });
          fileContent = typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);
        } else {
          fileContent = await fs.readFile(req.file.path, 'utf8');
        }
      } catch (e) {
        console.error('Failed to read/fetch file content during upload:', e.message);
      }
    }

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

      // Update main file record with latest content and path
      await query(
        `UPDATE project_files 
         SET file_path = @fpath, file_size = @size, mime_type = @mime, content = @content, uploaded_at = GETUTCDATE()
         WHERE id = @id`,
        {
          id: { type: sql.UniqueIdentifier, value: documentId },
          fpath: { type: sql.NVarChar, value: req.file.path },
          size: { type: sql.BigInt, value: req.file.size },
          mime: { type: sql.NVarChar, value: req.file.mimetype },
          content: { type: sql.NVarChar(sql.MAX), value: fileContent },
        }
      );

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
        `INSERT INTO project_files (id, project_id, uploaded_by, file_name, original_name, file_size, mime_type, file_path, domain, file_type, content)
         OUTPUT INSERTED.id, INSERTED.original_name, INSERTED.file_size, INSERTED.mime_type, INSERTED.uploaded_at
         VALUES (NEWID(), @pid, @uid, @fname, @oname, @size, @mime, @fpath, @domain, @fileType, @content)`,
        {
          pid:   { type: sql.UniqueIdentifier, value: req.params.projectId },
          uid:   { type: sql.UniqueIdentifier, value: req.user.id },
          fname: { type: sql.NVarChar, value: req.file.filename },
          oname: { type: sql.NVarChar, value: req.file.originalname },
          size:  { type: sql.BigInt, value: req.file.size },
          mime:  { type: sql.NVarChar, value: req.file.mimetype },
          fpath: { type: sql.NVarChar, value: req.file.path },
          domain: { type: sql.NVarChar(10), value: domain },
          fileType: { type: sql.NVarChar(30), value: fileType },
          content: { type: sql.NVarChar(sql.MAX), value: fileContent },
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
        outputType: { type: sql.NVarChar(30), value: fileType }, // use fileType
        changeNote: { type: sql.NVarChar(sql.MAX), value: changeNote },
        filePath: { type: sql.NVarChar(500), value: req.file.path },
        fileSize: { type: sql.BigInt, value: req.file.size },
        mimeType: { type: sql.NVarChar(100), value: req.file.mimetype },
        publishedBy: { type: sql.UniqueIdentifier, value: req.user.id },
      }
    );

    const file = {
      id: documentId,
      original_name: req.file.originalname,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      uploaded_at: new Date().toISOString(),
      uploaded_by_name: req.user.full_name,
      uploaded_by_team: req.user.team,
      domain,
      file_type: fileType,
      latest_version: effectiveVersion,
      publish_violations: violations,
    };

    const io = req.app.get('io');
    if (io) {
      io.to(`project:${req.params.projectId}`).emit('new_file', file);
      io.to(`project:${req.params.projectId}`).emit('workspace_activity', {
        activity_type: 'file_upload',
        target_type: 'file',
        target_name: req.file.originalname,
        actor_name: req.user.full_name,
        actor_team: req.user.team,
        created_at: new Date().toISOString(),
      });
    }

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'file_upload',
      targetType: 'file',
      targetId: documentId,
      targetName: req.file.originalname,
      projectId: req.params.projectId,
      metadata: { projectId: req.params.projectId, size: req.file.size, versionNumber: effectiveVersion, fileType, violations: violations.length },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, file });
  } catch (err) {
    res.status(500).json({ success: false, message: 'File upload failed.' });
  }
});

// ── POST /api/projects/:projectId/files/:fileId/lock ─────────────────────
router.post('/files/:fileId/lock', async (req, res) => {
  try {
    const { duration = 30 } = req.body; // minutes
    const expiresAt = new Date(Date.now() + duration * 60 * 1000);

    const result = await query(
      `UPDATE project_files
       SET is_locked = 1, locked_by = @userId, lock_expires_at = @expiresAt
       OUTPUT INSERTED.locked_by, INSERTED.lock_expires_at
       WHERE id = @fileId AND project_id = @projectId AND (is_locked = 0 OR locked_by = @userId OR lock_expires_at < GETUTCDATE())`,
      {
        fileId: { type: sql.UniqueIdentifier, value: req.params.fileId },
        projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
        userId: { type: sql.UniqueIdentifier, value: req.user.id },
        expiresAt: { type: sql.DateTime2, value: expiresAt },
      }
    );

    if (!result.recordset.length) {
      return res.status(409).json({ success: false, message: 'File is already locked by another user.' });
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`project:${req.params.projectId}`).emit('file_locked', {
        fileId: req.params.fileId,
        lockedBy: req.user.id,
        lockedByName: req.user.full_name,
        expiresAt: expiresAt.toISOString(),
      });
    }

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'file_locked',
      targetType: 'file',
      targetId: req.params.fileId,
      projectId: req.params.projectId,
      metadata: { duration },
      ipAddress: req.ip,
    });

    res.json({ success: true, locked: true, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to lock file.' });
  }
});

// ── POST /api/projects/:projectId/files/:fileId/unlock ───────────────────
router.post('/files/:fileId/unlock', async (req, res) => {
  try {
    const result = await query(
      `UPDATE project_files
       SET is_locked = 0, locked_by = NULL, lock_expires_at = NULL
       OUTPUT INSERTED.id
       WHERE id = @fileId AND project_id = @projectId AND locked_by = @userId`,
      {
        fileId: { type: sql.UniqueIdentifier, value: req.params.fileId },
        projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
        userId: { type: sql.UniqueIdentifier, value: req.user.id },
      }
    );

    if (!result.recordset.length) {
      return res.status(403).json({ success: false, message: 'You do not have permission to unlock this file.' });
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`project:${req.params.projectId}`).emit('file_unlocked', { fileId: req.params.fileId });
    }

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'file_unlocked',
      targetType: 'file',
      targetId: req.params.fileId,
      projectId: req.params.projectId,
      ipAddress: req.ip,
    });

    res.json({ success: true, unlocked: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to unlock file.' });
  }
});

// ── DELETE /api/projects/:projectId/files/:fileId ────────────────────────
router.delete('/files/:fileId', async (req, res) => {
  try {
    const { projectId, fileId } = req.params;

    // Check if file exists and user has permission (admin or uploader)
    const fileResult = await query(
      `SELECT pf.id, pf.file_path, pf.uploaded_by, pf.original_name, p.env_id 
       FROM project_files pf
       JOIN projects p ON p.id = pf.project_id
       WHERE pf.id = @fileId AND pf.project_id = @projectId`,
      { fileId: { type: sql.UniqueIdentifier, value: fileId }, projectId: { type: sql.UniqueIdentifier, value: projectId } }
    );

    if (!fileResult.recordset.length) {
      return res.status(404).json({ success: false, message: 'File not found.' });
    }

    const file = fileResult.recordset[0];

    // Permission check
    const isAdmin = ['admin', 'platform_admin'].includes(req.user.role);
    if (!isAdmin && file.uploaded_by !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Only an admin or the uploader can delete this file.' });
    }

    // Delete versions
    await query(`DELETE FROM project_file_versions WHERE file_id = @fileId`, { fileId: { type: sql.UniqueIdentifier, value: fileId } });
    
    // Delete annotations and replies
    const annIds = await query(`SELECT id FROM document_annotations WHERE document_id = @fileId`, { fileId: { type: sql.UniqueIdentifier, value: fileId } });
    for (const ann of annIds.recordset) {
      await query(`DELETE FROM annotation_replies WHERE annotation_id = @id`, { id: { type: sql.UniqueIdentifier, value: ann.id } });
    }
    await query(`DELETE FROM document_annotations WHERE document_id = @fileId`, { fileId: { type: sql.UniqueIdentifier, value: fileId } });

    // Delete main file record
    await query(`DELETE FROM project_files WHERE id = @fileId`, { fileId: { type: sql.UniqueIdentifier, value: fileId } });

    // Delete physical file or remote cloud file
    try {
      if (file.file_path) {
        if (file.file_path.startsWith('http')) {
          // Cloudinary deletion
          // Note: In CloudinaryStorage, pf.file_name usually contains the public_id
          const publicId = file.file_path.split('/').pop().split('.')[0]; 
          // Better: use the filename stored which is the public_id from CloudinaryStorage
          const actualPublicId = file.file_name; 
          await cloudinary.uploader.destroy(actualPublicId);
        } else {
          await fs.unlink(file.file_path);
        }
      }
    } catch (e) {
      console.warn('Physical/Cloud file delete failed:', e.message);
    }

    await auditLog({
      envId: file.env_id,
      actorId: req.user.id,
      actionType: 'file_deleted',
      targetType: 'file',
      targetId: fileId,
      targetName: file.original_name,
      projectId: projectId,
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'File and all associated data deleted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to delete file.' });
  }
});

// ── GET /api/projects/:projectId/files/:fileId/content ───────────────────
router.get('/files/:fileId/content', async (req, res) => {
  try {
    const file = await query(
      `SELECT pf.content, pf.mime_type, pf.is_locked, pf.locked_by, u.full_name as locked_by_name, pf.lock_expires_at
       FROM project_files pf
       LEFT JOIN users u ON u.id = pf.locked_by
       WHERE pf.id = @fileId AND pf.project_id = @projectId`,
      {
        fileId: { type: sql.UniqueIdentifier, value: req.params.fileId },
        projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
      }
    );

    if (!file.recordset.length) {
      return res.status(404).json({ success: false, message: 'File not found.' });
    }

    const f = file.recordset[0];
    if (f.is_locked && f.locked_by !== req.user.id && f.lock_expires_at > new Date()) {
      return res.status(423).json({ success: false, message: 'File is locked by another user.', lockedBy: f.locked_by_name });
    }

    res.json({ success: true, content: f.content, mimeType: f.mime_type });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch file content.' });
  }
});

// ── PUT /api/projects/:projectId/files/:fileId/content ───────────────────
router.put('/files/:fileId/content', async (req, res) => {
  try {
    const { content } = req.body;

    const file = await query(
      `SELECT is_locked, locked_by, lock_expires_at
       FROM project_files
       WHERE id = @fileId AND project_id = @projectId`,
      {
        fileId: { type: sql.UniqueIdentifier, value: req.params.fileId },
        projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
      }
    );

    if (!file.recordset.length) {
      return res.status(404).json({ success: false, message: 'File not found.' });
    }

    const f = file.recordset[0];
    if (f.is_locked && f.locked_by !== req.user.id && f.lock_expires_at > new Date()) {
      return res.status(423).json({ success: false, message: 'File is locked by another user.' });
    }

    await query(
      `UPDATE project_files SET content = @content WHERE id = @fileId`,
      {
        fileId: { type: sql.UniqueIdentifier, value: req.params.fileId },
        content: { type: sql.NVarChar(sql.MAX), value: content },
      }
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`project:${req.params.projectId}`).emit('file_content_updated', {
        fileId: req.params.fileId,
        updatedBy: req.user.id,
        updatedByName: req.user.full_name,
        updatedAt: new Date().toISOString(),
      });
    }

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'file_content_updated',
      targetType: 'file',
      targetId: req.params.fileId,
      projectId: req.params.projectId,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save file content.' });
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
    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'breach_resolved',
      targetType: 'breach',
      targetId: breachId,
      projectId: req.params.projectId,
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'Breach resolved.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to resolve breach.' });
  }
});

// ── GET /api/projects/:projectId/annotations ─────────────────────────────
router.get('/annotations', async (req, res) => {
  try {
    const { documentId, documentVersion } = req.query;
    let whereClause = 'WHERE da.project_id = @projectId AND da.env_id = @envId';
    const params = {
      projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
      envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
    };

    if (documentId) {
      whereClause += ' AND da.document_id = @documentId';
      params.documentId = { type: sql.UniqueIdentifier, value: documentId };
    }
    if (documentVersion) {
      whereClause += ' AND da.document_version = @documentVersion';
      params.documentVersion = { type: sql.NVarChar, value: documentVersion };
    }

    const result = await query(
      `SELECT da.id, da.document_id, da.document_version, da.selected_text,
              da.position_start, da.position_end, da.type, da.body, da.status,
              da.requires_resolution, da.resolved_at, da.created_at,
              u.full_name as author_name, u.team as author_team, u.avatar_initials,
              ar.id as reply_id, ar.reply_text, ar.created_at as reply_created_at,
              ru.full_name as reply_author_name, ru.team as reply_author_team
       FROM document_annotations da
       LEFT JOIN users u ON u.id = da.author_id
       LEFT JOIN annotation_replies ar ON ar.annotation_id = da.id
       LEFT JOIN users ru ON ru.id = ar.author_id
       ${whereClause}
       ORDER BY da.created_at ASC, ar.created_at ASC`,
      params
    );

    // Group replies under annotations
    const annotations = {};
    result.recordset.forEach(row => {
      if (!annotations[row.id]) {
        annotations[row.id] = {
          id: row.id,
          document_id: row.document_id,
          document_version: row.document_version,
          selected_text: row.selected_text,
          position_start: row.position_start,
          position_end: row.position_end,
          type: row.type,
          body: row.body,
          status: row.status,
          requires_resolution: row.requires_resolution,
          resolved_at: row.resolved_at,
          created_at: row.created_at,
          author: {
            name: row.author_name,
            team: row.author_team,
            avatar_initials: row.avatar_initials,
          },
          replies: [],
        };
      }
      if (row.reply_id) {
        annotations[row.id].replies.push({
          id: row.reply_id,
          text: row.reply_text,
          created_at: row.reply_created_at,
          author: {
            name: row.reply_author_name,
            team: row.reply_author_team,
          },
        });
      }
    });

    res.json({ success: true, annotations: Object.values(annotations) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch annotations.' });
  }
});

// ── POST /api/projects/:projectId/annotations ────────────────────────────
router.post('/annotations', async (req, res) => {
  try {
    const { documentId, documentVersion, selectedText, positionStart, positionEnd, type, body, requiresResolution } = req.body;

    if (!documentId || !type || !body) {
      return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    // Get document info
    const docResult = await query(
      `SELECT uploaded_by FROM project_files WHERE id = @docId AND project_id = @projectId`,
      {
        docId: { type: sql.UniqueIdentifier, value: documentId },
        projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
      }
    );
    if (!docResult.recordset.length) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }

    const documentOwnerId = docResult.recordset[0].uploaded_by;

    // Create annotation
    const result = await query(
      `INSERT INTO document_annotations
         (id, env_id, project_id, document_id, document_version, selected_text,
          position_start, position_end, author_id, type, body, requires_resolution)
       OUTPUT INSERTED.*
       VALUES
         (NEWID(), @envId, @projectId, @documentId, @documentVersion, @selectedText,
          @positionStart, @positionEnd, @authorId, @type, @body, @requiresResolution)`,
      {
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
        documentId: { type: sql.UniqueIdentifier, value: documentId },
        documentVersion: { type: sql.NVarChar, value: documentVersion || null },
        selectedText: { type: sql.NVarChar(sql.MAX), value: selectedText || null },
        positionStart: { type: sql.Int, value: positionStart || null },
        positionEnd: { type: sql.Int, value: positionEnd || null },
        authorId: { type: sql.UniqueIdentifier, value: req.user.id },
        type: { type: sql.NVarChar, value: type },
        body: { type: sql.NVarChar(sql.MAX), value: body },
        requiresResolution: { type: sql.Bit, value: requiresResolution || false },
      }
    );

    const annotation = result.recordset[0];

    // If requires resolution, create a linked task
    let linkedTaskId = null;
    if (requiresResolution) {
      const taskResult = await query(
        `INSERT INTO tasks
           (id, project_id, env_id, title, description, assigned_to, created_by, type)
         OUTPUT INSERTED.id
         VALUES
           (NEWID(), @projectId, @envId, @title, @description, @assignedTo, @createdBy, 'OTHER')`,
        {
          projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
          envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
          title: { type: sql.NVarChar, value: `Resolve annotation: ${body.substring(0, 50)}...` },
          description: { type: sql.NVarChar(sql.MAX), value: `Annotation requires resolution: ${body}` },
          assignedTo: { type: sql.UniqueIdentifier, value: documentOwnerId },
          createdBy: { type: sql.UniqueIdentifier, value: req.user.id },
        }
      );
      linkedTaskId = taskResult.recordset[0].id;

      // Update annotation with linked task
      await query(
        `UPDATE document_annotations SET linked_task_id = @taskId WHERE id = @annotationId`,
        {
          taskId: { type: sql.UniqueIdentifier, value: linkedTaskId },
          annotationId: { type: sql.UniqueIdentifier, value: annotation.id },
        }
      );
    }

    // Notify document owner
    if (documentOwnerId !== req.user.id) {
      await notify({
        userId: documentOwnerId,
        type: 'annotation_created',
        title: 'New annotation on your document',
        body: `A new ${type.toLowerCase()} annotation was added to your document.`,
        refId: annotation.id,
        io: req.app.get('io')
      });
    }

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'annotation_created',
      targetType: 'annotation',
      targetId: annotation.id,
      projectId: req.params.projectId,
      metadata: {
        annotationId: annotation.id,
        documentId,
        type,
      },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, annotation: { ...annotation, linked_task_id: linkedTaskId } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to create annotation.' });
  }
});

// ── POST /api/projects/:projectId/annotations/:annotationId/replies ──────
router.post('/annotations/:annotationId/replies', async (req, res) => {
  try {
    const { replyText } = req.body;

    if (!replyText?.trim()) {
      return res.status(400).json({ success: false, message: 'Reply text is required.' });
    }

    // Verify annotation exists and user has access
    const annResult = await query(
      `SELECT da.id, pf.uploaded_by FROM document_annotations da
       JOIN project_files pf ON pf.id = da.document_id
       WHERE da.id = @annotationId AND da.project_id = @projectId`,
      {
        annotationId: { type: sql.UniqueIdentifier, value: req.params.annotationId },
        projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
      }
    );
    if (!annResult.recordset.length) {
      return res.status(404).json({ success: false, message: 'Annotation not found.' });
    }

    const documentOwnerId = annResult.recordset[0].uploaded_by;

    // Create reply
    const result = await query(
      `INSERT INTO annotation_replies (id, annotation_id, author_id, reply_text)
       OUTPUT INSERTED.*
       VALUES (NEWID(), @annotationId, @authorId, @replyText)`,
      {
        annotationId: { type: sql.UniqueIdentifier, value: req.params.annotationId },
        authorId: { type: sql.UniqueIdentifier, value: req.user.id },
        replyText: { type: sql.NVarChar(sql.MAX), value: replyText.trim() },
      }
    );

    const reply = result.recordset[0];

    // Notify annotation author and document owner if different
    const notifyUsers = new Set();
    const annAuthorResult = await query(
      `SELECT author_id FROM document_annotations WHERE id = @annotationId`,
      { annotationId: { type: sql.UniqueIdentifier, value: req.params.annotationId } }
    );
    if (annAuthorResult.recordset[0].author_id !== req.user.id) {
      notifyUsers.add(annAuthorResult.recordset[0].author_id);
    }
    if (documentOwnerId !== req.user.id && documentOwnerId !== annAuthorResult.recordset[0].author_id) {
      notifyUsers.add(documentOwnerId);
    }

    for (const userId of notifyUsers) {
      await notify({
        userId: userId,
        type: 'annotation_reply',
        title: 'New reply to annotation',
        body: 'Someone replied to an annotation on a document.',
        refId: req.params.annotationId,
        io: req.app.get('io')
      });
    }

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'annotation_reply',
      targetType: 'annotation',
      targetId: req.params.annotationId,
      projectId: req.params.projectId,
      metadata: {
        annotationId: req.params.annotationId,
        replyId: reply.id,
      },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to add reply.' });
  }
});

// ── PATCH /api/projects/:projectId/annotations/:annotationId/resolve ─────
router.patch('/annotations/:annotationId/resolve', async (req, res) => {
  try {
    // Verify annotation exists and user can resolve it
    const annResult = await query(
      `SELECT da.id, da.status, da.linked_task_id, da.author_id, pf.uploaded_by
       FROM document_annotations da
       JOIN project_files pf ON pf.id = da.document_id
       WHERE da.id = @annotationId AND da.project_id = @projectId`,
      {
        annotationId: { type: sql.UniqueIdentifier, value: req.params.annotationId },
        projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
      }
    );
    if (!annResult.recordset.length) {
      return res.status(404).json({ success: false, message: 'Annotation not found.' });
    }

    const annotation = annResult.recordset[0];
    if (annotation.status === 'RESOLVED') {
      return res.status(400).json({ success: false, message: 'Annotation already resolved.' });
    }

    // Only annotation author or document owner can resolve
    if (req.user.id !== annotation.author_id && req.user.id !== annotation.uploaded_by) {
      return res.status(403).json({ success: false, message: 'You cannot resolve this annotation.' });
    }

    // Update annotation
    await query(
      `UPDATE document_annotations
       SET status = 'RESOLVED', resolved_at = GETUTCDATE(), resolved_by = @resolvedBy
       WHERE id = @annotationId`,
      {
        annotationId: { type: sql.UniqueIdentifier, value: req.params.annotationId },
        resolvedBy: { type: sql.UniqueIdentifier, value: req.user.id },
      }
    );

    // Close linked task if exists
    if (annotation.linked_task_id) {
      await query(
        `UPDATE tasks SET status = 'done', completed_at = GETUTCDATE(), closed_by = @closedBy
         WHERE id = @taskId`,
        {
          taskId: { type: sql.UniqueIdentifier, value: annotation.linked_task_id },
          closedBy: { type: sql.UniqueIdentifier, value: req.user.id },
        }
      );
    }

    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'annotation_resolved',
      targetType: 'annotation',
      targetId: req.params.annotationId,
      projectId: req.params.projectId,
      metadata: {
        annotationId: req.params.annotationId,
      },
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'Annotation resolved.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to resolve annotation.' });
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

// ===== FEATURE 3.8 WORKSPACE HUB ENDPOINTS =====

// GET /api/projects/:projectId/workspace/health - Project health indicators
router.get('/workspace/health', async (req, res) => {
  try {
    const result = await query(
      `SELECT
         (SELECT COUNT(*) FROM tasks WHERE project_id = @pid) as total_tasks,
         (SELECT COUNT(*) FROM tasks WHERE project_id = @pid AND status = 'done') as completed_tasks,
         (SELECT COUNT(*) FROM tasks WHERE project_id = @pid AND status != 'done' AND due_date < CAST(GETUTCDATE() AS DATE)) as overdue_tasks,
         (SELECT COUNT(*) FROM conflict_records WHERE project_id = @pid AND status IN ('OPEN','IN_RESOLUTION','ESCALATED')) as open_conflicts,
         (SELECT COUNT(*) FROM document_annotations da
          JOIN project_files pf ON da.document_id = pf.id
          WHERE pf.project_id = @pid AND da.status = 'OPEN' AND da.requires_resolution = 1
         ) as open_annotations,
         (SELECT COUNT(*) FROM project_messages pm
          JOIN project_members pmem ON pm.project_id = pmem.project_id
          WHERE pm.project_id = @pid AND pmem.user_id = @uid
            AND pm.sent_at > ISNULL(pmem.last_message_read, '1900-01-01')
         ) as unread_messages,
         DATEDIFF(DAY, CAST(GETUTCDATE() AS DATE), p.end_date) as days_remaining,
         (SELECT COUNT(*) FROM project_milestones WHERE project_id = @pid AND is_completed = 1) as completed_milestones,
         (SELECT COUNT(*) FROM project_milestones WHERE project_id = @pid) as total_milestones,
         CASE
           WHEN (SELECT COUNT(*) FROM tasks WHERE project_id = @pid) = 0 THEN 0
           ELSE CAST((SELECT COUNT(*) FROM tasks WHERE project_id = @pid AND status = 'done') AS FLOAT)
                / (SELECT COUNT(*) FROM tasks WHERE project_id = @pid) * 100
         END as task_completion_percentage,
         p.name as project_name,
         p.status as project_status
       FROM projects p
       WHERE p.id = @pid`,
      {
        pid: { type: sql.UniqueIdentifier, value: req.params.projectId },
        uid: { type: sql.UniqueIdentifier, value: req.user.id }
      }
    );

    res.json({ success: true, health: result.recordset[0] || {} });
  } catch (err) {
    console.error('Health endpoint error:', err);
    res.json({ success: true, health: {} });
  }
});

// GET /api/projects/:projectId/workspace/members - Member activity summary
router.get('/workspace/members', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
         u.id,
         u.full_name,
         u.team,
         u.avatar_initials,
         CASE 
           WHEN u.last_login_at > DATEADD(HOUR, -2, GETUTCDATE()) THEN 'online'
           WHEN u.last_login_at > DATEADD(DAY, -1, GETUTCDATE()) THEN 'recent'
           ELSE 'offline'
         END as presence_status,
         (
           SELECT COUNT(*) 
           FROM audit_logs a 
           WHERE a.actor_id = u.id 
             AND a.created_at > DATEADD(DAY, -7, GETUTCDATE())
             AND (
               a.target_id IN (SELECT CAST(id AS NVARCHAR(100)) FROM projects WHERE id = @pid)
               OR a.metadata LIKE '%project_id%' + CAST(@pid AS NVARCHAR(36)) + '%'
             )
         ) as actions_this_week,
         (
           SELECT COUNT(*) 
           FROM tasks t 
           WHERE t.assigned_to = u.id 
             AND t.project_id = @pid 
             AND t.status != 'done'
         ) as pending_tasks,
         pm.added_at as member_since,
         pm.workspace_role
       FROM users u
       JOIN project_members pm ON u.id = pm.user_id
       WHERE pm.project_id = @pid 
         AND pm.is_active = 1
       ORDER BY u.full_name`,
      {
        pid: { type: sql.UniqueIdentifier, value: req.params.projectId }
      }
    );
    
    res.json({ success: true, members: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch member activity summary.' });
  }
});

// GET /api/projects/:projectId/workspace/activity-feed - Recent workspace activity
router.get('/workspace/activity-feed', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    
    const result = await query(
      `SELECT 
         wa.id,
         wa.activity_type,
         wa.target_type,
         wa.target_id,
         wa.target_name,
         wa.description,
         wa.metadata,
         wa.created_at,
         u.full_name as actor_name,
         u.team as actor_team,
         u.avatar_initials
       FROM workspace_activity_feed wa
       JOIN users u ON u.id = wa.actor_id
       WHERE wa.project_id = @pid AND wa.is_visible = 1
       ORDER BY wa.created_at DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      {
        pid: { type: sql.UniqueIdentifier, value: req.params.projectId },
        offset: { type: sql.Int, value: parseInt(offset) },
        limit: { type: sql.Int, value: parseInt(limit) }
      }
    );
    
    res.json({ success: true, activities: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch activity feed.' });
  }
});

// POST /api/projects/:projectId/workspace/activity - Log workspace activity
router.post('/workspace/activity', async (req, res) => {
  try {
    const { activityType, targetType, targetId, targetName, description, metadata } = req.body;
    
    if (!activityType || !description) {
      return res.status(400).json({ success: false, message: 'Activity type and description are required.' });
    }
    
    await query(
      `INSERT INTO workspace_activity_feed 
         (id, project_id, activity_type, actor_id, target_type, target_id, target_name, description, metadata)
       VALUES (NEWID(), @pid, @activityType, @actorId, @targetType, @targetId, @targetName, @description, @metadata)`,
      {
        pid: { type: sql.UniqueIdentifier, value: req.params.projectId },
        activityType: { type: sql.NVarChar, value: activityType },
        actorId: { type: sql.UniqueIdentifier, value: req.user.id },
        targetType: { type: sql.NVarChar, value: targetType || null },
        targetId: { type: sql.UniqueIdentifier, value: targetId || null },
        targetName: { type: sql.NVarChar, value: targetName || null },
        description: { type: sql.NVarChar(sql.MAX), value: description },
        metadata: { type: sql.NVarChar(sql.MAX), value: metadata ? JSON.stringify(metadata) : null }
      }
    );
    
    // Broadcast to project members
    const io = req.app.get('io');
    if (io) {
      io.to(`project:${req.params.projectId}`).emit('workspace_activity', {
        activityType,
        actorId: req.user.id,
        actorName: req.user.full_name,
        actorTeam: req.user.team,
        targetType,
        targetId,
        targetName,
        description,
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(201).json({ success: true, message: 'Activity logged successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to log activity.' });
  }
});

// ===== FILE COLLABORATION ENDPOINTS =====

// GET /api/projects/:projectId/files/:fileId/editors - Active file editors
router.get('/files/:fileId/editors', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
         u.id,
         u.full_name,
         u.team,
         u.avatar_initials,
         fce.last_seen_at,
         fce.cursor_position,
         fce.cursor_color
       FROM file_collaboration_editors fce
       JOIN users u ON fce.user_id = u.id
       WHERE fce.file_id = @fileId
         AND fce.last_seen_at > DATEADD(MINUTE, -5, GETUTCDATE())
       ORDER BY fce.last_seen_at DESC`,
      {
        fileId: { type: sql.UniqueIdentifier, value: req.params.fileId }
      }
    );
    
    res.json({ success: true, editors: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch active editors.' });
  }
});

// POST /api/projects/:projectId/files/:fileId/editors/join - Join file editing
router.post('/files/:fileId/editors/join', async (req, res) => {
  try {
    const { cursorPosition, cursorColor = '#000000' } = req.body;
    
    await query(
      `MERGE file_collaboration_editors AS target
       USING (VALUES (@fileId, @userId, @cursorPosition, @cursorColor, GETUTCDATE())) 
       AS source (file_id, user_id, cursor_position, cursor_color, last_seen_at)
       ON target.file_id = source.file_id AND target.user_id = source.user_id
       WHEN MATCHED THEN
         UPDATE SET 
           cursor_position = source.cursor_position,
           cursor_color = source.cursor_color,
           last_seen_at = source.last_seen_at
       WHEN NOT MATCHED THEN
         INSERT (file_id, user_id, cursor_position, cursor_color, last_seen_at)
         VALUES (source.file_id, source.user_id, source.cursor_position, source.cursor_color, source.last_seen_at);`,
      {
        fileId: { type: sql.UniqueIdentifier, value: req.params.fileId },
        userId: { type: sql.UniqueIdentifier, value: req.user.id },
        cursorPosition: { type: sql.NVarChar, value: cursorPosition || null },
        cursorColor: { type: sql.NVarChar, value: cursorColor }
      }
    );
    
    // Broadcast to other editors
    const io = req.app.get('io');
    if (io) {
      io.to(`project:${req.params.projectId}`).emit('editor_joined', {
        fileId: req.params.fileId,
        userId: req.user.id,
        userName: req.user.full_name,
        userTeam: req.user.team,
        cursorPosition,
        cursorColor,
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({ success: true, message: 'Joined file editing successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to join file editing.' });
  }
});

// POST /api/projects/:projectId/files/:fileId/editors/leave - Leave file editing
router.post('/files/:fileId/editors/leave', async (req, res) => {
  try {
    await query(
      `DELETE FROM file_collaboration_editors
       WHERE file_id = @fileId AND user_id = @userId`,
      {
        fileId: { type: sql.UniqueIdentifier, value: req.params.fileId },
        userId: { type: sql.UniqueIdentifier, value: req.user.id }
      }
    );
    
    // Broadcast to other editors
    const io = req.app.get('io');
    if (io) {
      io.to(`project:${req.params.projectId}`).emit('editor_left', {
        fileId: req.params.fileId,
        userId: req.user.id,
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({ success: true, message: 'Left file editing successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to leave file editing.' });
  }
});

// PUT /api/projects/:projectId/files/:fileId/editors/cursor - Update cursor position
router.put('/files/:fileId/editors/cursor', async (req, res) => {
  try {
    const { cursorPosition, cursorColor } = req.body;
    
    await query(
      `UPDATE file_collaboration_editors
       SET cursor_position = @cursorPosition, 
           cursor_color = @cursorColor,
           last_seen_at = GETUTCDATE()
       WHERE file_id = @fileId AND user_id = @userId`,
      {
        fileId: { type: sql.UniqueIdentifier, value: req.params.fileId },
        userId: { type: sql.UniqueIdentifier, value: req.user.id },
        cursorPosition: { type: sql.NVarChar, value: cursorPosition || null },
        cursorColor: { type: sql.NVarChar, value: cursorColor || '#000000' }
      }
    );
    
    // Broadcast to other editors
    const io = req.app.get('io');
    if (io) {
      io.to(`project:${req.params.projectId}`).emit('cursor_update', {
        fileId: req.params.fileId,
        userId: req.user.id,
        cursorPosition,
        cursorColor,
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({ success: true, message: 'Cursor position updated.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update cursor position.' });
  }
});

// ===== ENHANCED MESSAGING ENDPOINTS =====

// GET /api/projects/:projectId/messages/threaded - Messages with threading
router.get('/messages/threaded', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    
    const result = await query(
      `WITH MessageThread AS (
        SELECT 
          m.id,
          m.project_id,
          m.sender_id,
          m.content,
          m.sent_at,
          m.parent_message_id,
          m.message_type,
          m.attachment_data,
          m.linked_task_id,
          0 as thread_level,
          ROW_NUMBER() OVER (ORDER BY m.sent_at DESC) as row_num
        FROM project_messages m
        WHERE m.project_id = @pid 
          AND m.is_archived = 0
      
        UNION ALL
      
        SELECT 
          m.id,
          m.project_id,
          m.sender_id,
          m.content,
          m.sent_at,
          m.parent_message_id,
          m.message_type,
          m.attachment_data,
          m.linked_task_id,
          1 as thread_level,
          ROW_NUMBER() OVER (ORDER BY m.sent_at DESC) as row_num
        FROM project_messages m
        WHERE m.project_id = @pid 
          AND m.parent_message_id IS NOT NULL
          AND m.is_archived = 0
      )
      SELECT 
        mt.*,
        u.full_name as sender_name,
        u.team as sender_team,
        u.avatar_initials
      FROM MessageThread mt
      JOIN users u ON mt.sender_id = u.id
      ORDER BY mt.sent_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      {
        pid: { type: sql.UniqueIdentifier, value: req.params.projectId },
        offset: { type: sql.Int, value: parseInt(offset) },
        limit: { type: sql.Int, value: parseInt(limit) }
      }
    );
    
    res.json({ success: true, messages: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch threaded messages.' });
  }
});

// POST /api/projects/:projectId/messages/threaded - Send threaded message
router.post('/messages/threaded', async (req, res) => {
  try {
    const { content, parentMessageId, messageType = 'TEXT', attachmentData } = req.body;
    
    if (!content?.trim()) {
      return res.status(400).json({ success: false, message: 'Message content is required.' });
    }
    
    const result = await query(
      `INSERT INTO project_messages 
         (id, project_id, sender_id, content, parent_message_id, message_type, attachment_data)
       OUTPUT INSERTED.id, INSERTED.content, INSERTED.sent_at, INSERTED.parent_message_id, INSERTED.message_type, INSERTED.attachment_data
       VALUES (NEWID(), @pid, @uid, @content, @parentMessageId, @messageType, @attachmentData)`,
      {
        pid: { type: sql.UniqueIdentifier, value: req.params.projectId },
        uid: { type: sql.UniqueIdentifier, value: req.user.id },
        content: { type: sql.NVarChar(sql.MAX), value: content.trim() },
        parentMessageId: { type: sql.UniqueIdentifier, value: parentMessageId || null },
        messageType: { type: sql.NVarChar, value: messageType },
        attachmentData: { type: sql.NVarChar(sql.MAX), value: attachmentData ? JSON.stringify(attachmentData) : null }
      }
    );
    
    const message = {
      ...result.recordset[0],
      sender_id: req.user.id,
      sender_name: req.user.full_name,
      sender_team: req.user.team,
      avatar_initials: req.user.avatar_initials
    };
    
    // Broadcast to project members
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
      projectId: req.params.projectId,
      metadata: { 
        messageId: message.id, 
        parentMessageId, 
        messageType,
        contentPreview: content.substring(0, 100) + (content.length > 100 ? '...' : '')
      },
      ipAddress: req.ip,
    });
    
    res.status(201).json({ success: true, message });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
});

// POST /api/projects/:projectId/messages/:messageId/task - Convert message to task
router.post('/messages/:messageId/task', async (req, res) => {
  try {
    const { title, description, assigneeId, priority = 'Medium', taskType = 'OTHER', dueDate } = req.body;
    
    if (!title?.trim()) {
      return res.status(400).json({ success: false, message: 'Task title is required.' });
    }
    
    // Get message details
    const messageResult = await query(
      `SELECT content, sender_id FROM project_messages WHERE id = @messageId AND project_id = @projectId`,
      {
        messageId: { type: sql.UniqueIdentifier, value: req.params.messageId },
        projectId: { type: sql.UniqueIdentifier, value: req.params.projectId }
      }
    );
    
    if (!messageResult.recordset.length) {
      return res.status(404).json({ success: false, message: 'Message not found.' });
    }
    
    const message = messageResult.recordset[0];
    
    // Create task
    const taskResult = await query(
      `INSERT INTO tasks 
         (id, project_id, env_id, title, description, assigned_to, created_by, priority, type, due_date)
       OUTPUT INSERTED.id, INSERTED.title, INSERTED.description, INSERTED.status, INSERTED.created_at
       VALUES (NEWID(), @projectId, @envId, @title, @description, @assigneeId, @createdBy, @priority, @taskType, @dueDate)`,
      {
        projectId: { type: sql.UniqueIdentifier, value: req.params.projectId },
        envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
        title: { type: sql.NVarChar, value: title.trim() },
        description: { type: sql.NVarChar(sql.MAX), value: description || `Task created from message: "${message.content}"` },
        assigneeId: { type: sql.UniqueIdentifier, value: assigneeId || null },
        createdBy: { type: sql.UniqueIdentifier, value: req.user.id },
        priority: { type: sql.NVarChar, value: priority },
        taskType: { type: sql.NVarChar, value: taskType },
        dueDate: { type: sql.Date, value: dueDate || null }
      }
    );
    
    // Link message to task
    await query(
      `UPDATE project_messages SET linked_task_id = @taskId WHERE id = @messageId`,
      {
        taskId: { type: sql.UniqueIdentifier, value: taskResult.recordset[0].id },
        messageId: { type: sql.UniqueIdentifier, value: req.params.messageId }
      }
    );
    
    const task = taskResult.recordset[0];
    
    // Broadcast task creation
    const io = req.app.get('io');
    if (io) {
      io.to(`project:${req.params.projectId}`).emit('task_created', {
        ...task,
        created_by_name: req.user.full_name,
        created_by_team: req.user.team
      });
    }
    
    res.status(201).json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to convert message to task.' });
  }
});

// ===== WORKSPACE AUDIT HISTORY ENDPOINTS =====

// GET /api/projects/:projectId/workspace/audit - Contribution audit history
router.get('/workspace/audit', async (req, res) => {
  try {
    const { limit = 100, offset = 0, userId, actionType, dateFrom, dateTo } = req.query;
    
    let whereClause = `WHERE a.env_id = @envId AND a.project_id = @pid`;
    
    const params = {
      envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      pid: { type: sql.UniqueIdentifier, value: req.params.projectId },
      offset: { type: sql.Int, value: parseInt(offset) },
      limit: { type: sql.Int, value: parseInt(limit) }
    };
    
    if (userId) {
      whereClause += ` AND a.actor_id = @userId`;
      params.userId = { type: sql.UniqueIdentifier, value: userId };
    }
    
    if (actionType) {
      whereClause += ` AND a.action_type = @actionType`;
      params.actionType = { type: sql.NVarChar, value: actionType };
    }
    
    if (dateFrom) {
      whereClause += ` AND a.created_at >= @dateFrom`;
      params.dateFrom = { type: sql.DateTime2, value: new Date(dateFrom) };
    }
    
    if (dateTo) {
      whereClause += ` AND a.created_at <= @dateTo`;
      params.dateTo = { type: sql.DateTime2, value: new Date(dateTo) };
    }
    
    const result = await query(
      `SELECT 
         a.id,
         a.action_type,
         a.target_type,
         a.target_id,
         a.target_name,
         a.metadata,
         a.created_at,
         u.full_name as actor_name,
         u.team as actor_team,
         u.avatar_initials
       FROM audit_logs a
       JOIN users u ON a.actor_id = u.id
       ${whereClause}
       ORDER BY a.created_at DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      params
    );
    
    res.json({ success: true, audits: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch audit history.' });
  }
});

// GET /api/projects/:projectId/workspace/audit/summary - Contribution summary by user
router.get('/workspace/audit/summary', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    
    let whereClause = `WHERE u.env_id = @envId AND a.project_id = @pid`;
    
    const params = {
      envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      pid: { type: sql.UniqueIdentifier, value: req.params.projectId }
    };
    
    if (dateFrom) {
      whereClause += ` AND a.created_at >= @dateFrom`;
      params.dateFrom = { type: sql.DateTime2, value: new Date(dateFrom) };
    }
    
    if (dateTo) {
      whereClause += ` AND a.created_at <= @dateTo`;
      params.dateTo = { type: sql.DateTime2, value: new Date(dateTo) };
    }
    
    const result = await query(
      `SELECT 
         u.id as user_id,
         u.full_name,
         u.team,
         COUNT(*) as total_actions,
         COUNT(CASE WHEN a.action_type LIKE '%upload%' THEN 1 END) as file_uploads,
         COUNT(CASE WHEN a.action_type LIKE '%task%' THEN 1 END) as task_actions,
         COUNT(CASE WHEN a.action_type LIKE '%message%' THEN 1 END) as messages,
         COUNT(CASE WHEN a.action_type LIKE '%annotation%' THEN 1 END) as annotations,
         MIN(a.created_at) as first_activity,
         MAX(a.created_at) as last_activity
       FROM users u
       JOIN audit_logs a ON u.id = a.actor_id
       ${whereClause}
       GROUP BY u.id, u.full_name, u.team
       ORDER BY total_actions DESC`,
      params
    );
    
    res.json({ success: true, summary: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch contribution summary.' });
  }
});

// GET /api/projects/:projectId/workspace/audit/export - Export audit history
router.get('/workspace/audit/export', async (req, res) => {
  try {
    const { format = 'csv', userId, actionType, dateFrom, dateTo } = req.query;
    
    let whereClause = `WHERE a.env_id = @envId AND (
      a.target_id IN (SELECT CAST(id AS NVARCHAR(100)) FROM projects WHERE id = @pid)
      OR a.metadata LIKE '%project_id%' + CAST(@pid AS NVARCHAR(36)) + '%'
    )`;
    
    const params = {
      envId: { type: sql.UniqueIdentifier, value: req.user.env_id },
      pid: { type: sql.UniqueIdentifier, value: req.params.projectId }
    };
    
    if (userId) {
      whereClause += ` AND a.actor_id = @userId`;
      params.userId = { type: sql.UniqueIdentifier, value: userId };
    }
    
    if (actionType) {
      whereClause += ` AND a.action_type = @actionType`;
      params.actionType = { type: sql.NVarChar, value: actionType };
    }
    
    if (dateFrom) {
      whereClause += ` AND a.created_at >= @dateFrom`;
      params.dateFrom = { type: sql.DateTime2, value: new Date(dateFrom) };
    }
    
    if (dateTo) {
      whereClause += ` AND a.created_at <= @dateTo`;
      params.dateTo = { type: sql.DateTime2, value: new Date(dateTo) };
    }
    
    const result = await query(
      `SELECT 
         a.created_at as timestamp,
         u.full_name as actor_name,
         u.team as actor_team,
         a.action_type,
         a.target_type,
         a.target_name,
         a.metadata
       FROM audit_logs a
       JOIN users u ON a.actor_id = u.id
       ${whereClause}
       ORDER BY a.created_at DESC`,
      params
    );
    
    // Log the export action
    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'audit_export',
      targetType: 'project',
      targetId: req.params.projectId,
      metadata: { 
        format, 
        recordCount: result.recordset.length,
        filters: { userId, actionType, dateFrom, dateTo }
      },
      ipAddress: req.ip,
    });
    
    if (format === 'csv') {
      // Convert to CSV format
      const csvHeader = 'Timestamp,Actor Name,Actor Team,Action Type,Target Type,Target Name,Metadata\n';
      const csvData = result.recordset.map(row => 
        `"${row.timestamp}","${row.actor_name}","${row.actor_team}","${row.action_type}","${row.target_type}","${row.target_name}","${row.metadata || ''}"`
      ).join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="workspace-audit-${req.params.projectId}-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csvHeader + csvData);
    } else {
      res.json({ success: true, audits: result.recordset });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to export audit history.' });
  }
});

// GET /api/projects/:projectId/workspace/session - Track workspace session
router.post('/workspace/session', async (req, res) => {
  try {
    const { action = 'start' } = req.body; // 'start' or 'end'
    
    if (action === 'start') {
      await query(
        `INSERT INTO workspace_sessions 
           (id, project_id, user_id, session_start, last_activity, ip_address, user_agent)
         VALUES (NEWID(), @pid, @uid, GETUTCDATE(), GETUTCDATE(), @ipAddress, @userAgent)`,
        {
          pid: { type: sql.UniqueIdentifier, value: req.params.projectId },
          uid: { type: sql.UniqueIdentifier, value: req.user.id },
          ipAddress: { type: sql.NVarChar, value: req.ip },
          userAgent: { type: sql.NVarChar, value: req.get('User-Agent') || null }
        }
      );
    } else {
      await query(
        `UPDATE workspace_sessions 
         SET session_end = GETUTCDATE(), last_activity = GETUTCDATE()
         WHERE project_id = @pid AND user_id = @uid AND session_end IS NULL`,
        {
          pid: { type: sql.UniqueIdentifier, value: req.params.projectId },
          uid: { type: sql.UniqueIdentifier, value: req.user.id }
        }
      );
    }
    
    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: action === 'start' ? 'workspace_session_started' : 'workspace_session_ended',
      targetType: 'project',
      targetId: req.params.projectId,
      projectId: req.params.projectId,
      metadata: { ip: req.ip },
      ipAddress: req.ip,
    });

    res.json({ success: true, message: `Workspace session ${action}ed successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to track workspace session.' });
  }
});

module.exports = router;
