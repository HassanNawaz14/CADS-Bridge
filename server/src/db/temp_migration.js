const { query } = require('../db');

async function migrate() {
  console.log('Starting audit_logs migration...');
  try {
    // Check if project_id exists
    const check = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'audit_logs' AND column_name = 'project_id'
    `);

    if (check.recordset.length === 0) {
      console.log('Adding project_id column to audit_logs...');
      await query(`ALTER TABLE audit_logs ADD project_id UNIQUEIDENTIFIER NULL`);
      console.log('Column added.');
    } else {
      console.log('project_id column already exists.');
    }

    // Also check if document_annotations needs columns (e.g. resolved_by)
    const checkAnn = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'document_annotations' AND column_name = 'resolved_by'
    `);
    if (checkAnn.recordset.length === 0) {
      console.log('Adding resolved_by column to document_annotations...');
      await query(`ALTER TABLE document_annotations ADD resolved_by UNIQUEIDENTIFIER NULL`);
    }

    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed:', err);
  }
  process.exit(0);
}

migrate();
