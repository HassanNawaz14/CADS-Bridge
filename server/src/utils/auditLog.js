const { query, sql } = require('../db');
const logger = require('./logger');

/**
 * Write an audit log entry. Must complete within 500ms (NFR).
 * This is fire-and-forget but errors are logged internally.
 */
const auditLog = async ({
  envId,
  actorId = null,
  actionType,
  targetType = null,
  targetId = null,
  targetName = null,
  metadata = null,
  ipAddress = null,
}) => {
  try {
    await query(
      `INSERT INTO audit_logs
         (id, env_id, actor_id, action_type, target_type, target_id, target_name, metadata, ip_address)
       VALUES
         (NEWID(), @envId, @actorId, @actionType, @targetType, @targetId, @targetName, @metadata, @ip)`,
      {
        envId:      { type: sql.UniqueIdentifier, value: envId },
        actorId:    { type: sql.UniqueIdentifier, value: actorId },
        actionType: { type: sql.NVarChar(80),     value: actionType },
        targetType: { type: sql.NVarChar(50),      value: targetType },
        targetId:   { type: sql.NVarChar(100),     value: targetId },
        targetName: { type: sql.NVarChar(255),     value: targetName },
        metadata:   { type: sql.NVarChar(sql.MAX), value: metadata ? JSON.stringify(metadata) : null },
        ip:         { type: sql.NVarChar(45),      value: ipAddress },
      }
    );
  } catch (err) {
    // Never crash the request due to audit log failure — log internally
    logger.error('Audit log write failed:', { actionType, err: err.message });
  }
};

module.exports = { auditLog };
