/**
 * CADS-Bridge Database Seed
 * Creates a demo environment + platform admin for development
 * Run: node src/db/seed.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query, sql } = require('./index');
const logger = require('../utils/logger');

function generateEnvCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'CADS-';
  for (let i = 0; i < 12; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function seed() {
  try {
    const envCode = generateEnvCode();
    const envId = uuidv4();
    const adminId = uuidv4();
    const caAdminId = uuidv4();
    const dsAdminId = uuidv4();
    const superAdminId = uuidv4();

    const passwordHash = await bcrypt.hash('Admin@123', 10);

    // 1. Environment
    await query(
      `INSERT INTO environments (id, firm_name, industry, env_code)
       VALUES (@id, @firm, @ind, @code)`,
      {
        id:   { type: sql.UniqueIdentifier, value: envId },
        firm: { type: sql.NVarChar, value: 'Demo Corporation Ltd.' },
        ind:  { type: sql.NVarChar, value: 'Banking & Finance' },
        code: { type: sql.NVarChar, value: envCode },
      }
    );

    // 2. Platform Admin (super-admin, no env restriction)
    await query(
      `INSERT INTO users (id, env_id, full_name, email, password_hash, designation, team, role, status, avatar_initials)
       VALUES (@id, @envId, @name, @email, @hash, @desig, 'CA', 'platform_admin', 'active', 'PA')`,
      {
        id:    { type: sql.UniqueIdentifier, value: adminId },
        envId: { type: sql.UniqueIdentifier, value: envId },
        name:  { type: sql.NVarChar, value: 'Platform Admin' },
        email: { type: sql.NVarChar, value: 'admin@cadsbridge.com' },
        hash:  { type: sql.NVarChar, value: passwordHash },
        desig: { type: sql.NVarChar, value: 'Platform Administrator' },
      }
    );

    // 3. Demo CA Admin
    await query(
      `INSERT INTO users (id, env_id, full_name, email, password_hash, designation, team, role, status, avatar_initials)
       VALUES (@id, @envId, @name, @email, @hash, @desig, 'CA', 'admin', 'active', 'AR')`,
      {
        id:    { type: sql.UniqueIdentifier, value: caAdminId },
        envId: { type: sql.UniqueIdentifier, value: envId },
        name:  { type: sql.NVarChar, value: 'Ahmad Raza' },
        email: { type: sql.NVarChar, value: 'ca.admin@demo.com' },
        hash:  { type: sql.NVarChar, value: passwordHash },
        desig: { type: sql.NVarChar, value: 'Chief Accountant' },
      }
    );

    // 4. Demo DS Admin
    await query(
      `INSERT INTO users (id, env_id, full_name, email, password_hash, designation, team, role, status, avatar_initials)
       VALUES (@id, @envId, @name, @email, @hash, @desig, 'DS', 'admin', 'active', 'SK')`,
      {
        id:    { type: sql.UniqueIdentifier, value: dsAdminId },
        envId: { type: sql.UniqueIdentifier, value: envId },
        name:  { type: sql.NVarChar, value: 'Sara Khan' },
        email: { type: sql.NVarChar, value: 'ds.admin@demo.com' },
        hash:  { type: sql.NVarChar, value: passwordHash },
        desig: { type: sql.NVarChar, value: 'Lead Data Scientist' },
      }
    );

    // 4.5 Demo Super Admin
    await query(
      `INSERT INTO users (id, env_id, full_name, email, password_hash, designation, team, role, status, avatar_initials)
       VALUES (@id, @envId, @name, @email, @hash, @desig, 'NA', 'super_admin', 'active', 'SA')`,
      {
        id:    { type: sql.UniqueIdentifier, value: superAdminId },
        envId: { type: sql.UniqueIdentifier, value: envId },
        name:  { type: sql.NVarChar, value: 'Super Admin' },
        email: { type: sql.NVarChar, value: 'super.admin@demo.com' },
        hash:  { type: sql.NVarChar, value: passwordHash },
        desig: { type: sql.NVarChar, value: 'Overall Environment Super Admin' },
      }
    );

    // 5. Seed default KPI thresholds for demo env
    const thresholds = [
      { key: 'report_accuracy',        team: 'CA', min: 85 },
      { key: 'task_completion_rate',   team: 'CA', min: 75 },
      { key: 'audit_findings_resolved',team: 'CA', min: 70 },
      { key: 'model_accuracy',         team: 'DS', min: 80 },
      { key: 'pipeline_uptime',        team: 'DS', min: 95 },
      { key: 'prediction_delivery_rate',team: 'DS', min: 80 },
    ];

    for (const t of thresholds) {
      await query(
        `INSERT INTO kpi_thresholds (id, env_id, metric_key, min_value, team, updated_by)
         VALUES (NEWID(), @envId, @key, @min, @team, @by)`,
        {
          envId: { type: sql.UniqueIdentifier, value: envId },
          key:   { type: sql.NVarChar, value: t.key },
          min:   { type: sql.Decimal(10,4), value: t.min },
          team:  { type: sql.NVarChar, value: t.team },
          by:    { type: sql.UniqueIdentifier, value: adminId },
        }
      );
    }

    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║       CADS-Bridge Seed Successful! 🚀        ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Demo Environment Code : ${envCode.padEnd(19)}║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  Platform Admin  : admin@cadsbridge.com      ║');
    console.log('║  Super Admin     : super.admin@demo.com      ║');
    console.log('║  CA Admin        : ca.admin@demo.com         ║');
    console.log('║  DS Admin        : ds.admin@demo.com         ║');
    console.log('║  Password (all)  : Admin@123                 ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    process.exit(0);
  } catch (err) {
    logger.error('❌ Seed failed:', err.message);
    console.error(err);
    process.exit(1);
  }
}

seed();
