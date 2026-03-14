const { query, sql } = require('../db');
const logger = require('./logger');

/**
 * Create an in-app notification for a user.
 * Socket.IO emission is handled by passing io instance.
 */
const notify = async ({ userId, type, title, body, refId = null, io = null }) => {
  try {
    const result = await query(
      `INSERT INTO notifications (id, user_id, type, title, body, ref_id)
       OUTPUT INSERTED.*
       VALUES (NEWID(), @userId, @type, @title, @body, @refId)`,
      {
        userId: { type: sql.UniqueIdentifier, value: userId },
        type:   { type: sql.NVarChar(50),     value: type },
        title:  { type: sql.NVarChar(200),    value: title },
        body:   { type: sql.NVarChar(sql.MAX),value: body },
        refId:  { type: sql.NVarChar(100),    value: refId },
      }
    );

    const notif = result.recordset[0];

    // Real-time push via Socket.IO if available
    if (io && notif) {
      io.to(`user:${userId}`).emit('notification', {
        id: notif.id,
        type: notif.type,
        title: notif.title,
        body: notif.body,
        refId: notif.ref_id,
        createdAt: notif.created_at,
      });
    }

    return notif;
  } catch (err) {
    logger.error('Notification write failed:', { userId, type, err: err.message });
  }
};

module.exports = { notify };
