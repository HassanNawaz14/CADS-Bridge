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

    const file = {
      ...result.recordset[0],
      uploaded_by_name: req.user.full_name,
      uploaded_by_team: req.user.team,
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
      targetId: result.recordset[0].id,
      targetName: req.file.originalname,
      metadata: { projectId: req.params.projectId, size: req.file.size },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, file });
  } catch (err) {
    res.status(500).json({ success: false, message: 'File upload failed.' });
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
