const { query, sql } = require('../db');

/**
 * Log a change to project_history table
 * @param {Object} params
 * @param {string} params.projectId - Project ID
 * @param {string} params.changedBy - User ID who made the change
 * @param {string} params.changeType - Type of change (created, updated, approved, rejected, member_added, etc.)
 * @param {string} [params.fieldName] - Field that changed
 * @param {string} [params.oldValue] - Old value
 * @param {string} [params.newValue] - New value
 * @param {string} [params.changeNote] - Optional note
 */
const logProjectChange = async (params) => {
  const {
    projectId,
    changedBy,
    changeType,
    fieldName,
    oldValue,
    newValue,
    changeNote,
  } = params;

  try {
    await query(
      `INSERT INTO project_history (id, project_id, changed_by, change_type, field_name, old_value, new_value, change_note)
       VALUES (NEWID(), @pid, @by, @type, @field, @old, @new, @note)`,
      {
        pid:   { type: sql.UniqueIdentifier, value: projectId },
        by:    { type: sql.UniqueIdentifier, value: changedBy || null },
        type:  { type: sql.NVarChar, value: changeType },
        field: { type: sql.NVarChar, value: fieldName || null },
        old:   { type: sql.NVarChar(sql.MAX), value: oldValue || null },
        new:   { type: sql.NVarChar(sql.MAX), value: newValue || null },
        note:  { type: sql.NVarChar(sql.MAX), value: changeNote || null },
      }
    );
  } catch (err) {
    console.error('Failed to log project change:', err);
    // Don't throw, as this shouldn't break the main operation
  }
};

module.exports = { logProjectChange };