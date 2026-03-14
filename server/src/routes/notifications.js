const express = require('express');
const router = express.Router();
const { query, sql } = require('../db');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ── GET /api/notifications ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT TOP 50 id, type, title, body, is_read, ref_id, created_at
       FROM notifications
       WHERE user_id = @userId
       ORDER BY created_at DESC`,
      { userId: { type: sql.UniqueIdentifier, value: req.user.id } }
    );
    const unreadCount = result.recordset.filter((n) => !n.is_read).length;
    res.json({ success: true, notifications: result.recordset, unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch notifications.' });
  }
});

// ── PATCH /api/notifications/:id/read ────────────────────────────────────
router.patch('/:id/read', async (req, res) => {
  try {
    await query(
      `UPDATE notifications SET is_read = 1 WHERE id = @id AND user_id = @userId`,
      {
        id:     { type: sql.UniqueIdentifier, value: req.params.id },
        userId: { type: sql.UniqueIdentifier, value: req.user.id },
      }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to mark as read.' });
  }
});

// ── PATCH /api/notifications/read-all ────────────────────────────────────
router.patch('/read-all', async (req, res) => {
  try {
    await query(
      `UPDATE notifications SET is_read = 1 WHERE user_id = @userId AND is_read = 0`,
      { userId: { type: sql.UniqueIdentifier, value: req.user.id } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to mark all as read.' });
  }
});

module.exports = router;
