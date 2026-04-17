/**
 * CADS-Bridge Database Migration
 * Creates all tables for Iteration 1 / Sprint 1
 * Run: node src/db/migrate.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const sql = require('mssql');
const logger = require('../utils/logger');

const config = {
  server: process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: true,
    enableArithAbort: true,
  },
};

const migrations = [
  // ── 0. Create database if not exists ──────────────────────────────────
  `IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = '${process.env.DB_NAME}')
     CREATE DATABASE [${process.env.DB_NAME}];`,

  // ── 1. Environments (Firms) ───────────────────────────────────────────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='environments' AND xtype='U')
   CREATE TABLE environments (
     id            UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     firm_name     NVARCHAR(200)    NOT NULL,
     industry      NVARCHAR(100)    NOT NULL DEFAULT 'Other',
     env_code      NVARCHAR(20)     NOT NULL UNIQUE,   -- min 12-char alphanumeric token
     is_active     BIT              NOT NULL DEFAULT 1,
     created_at    DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
     updated_at    DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,

  // ── 2. Users ──────────────────────────────────────────────────────────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
   CREATE TABLE users (
     id              UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     env_id          UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
     full_name       NVARCHAR(150)    NOT NULL,
     email           NVARCHAR(255)    NOT NULL,
     password_hash   NVARCHAR(255)    NOT NULL,
     designation     NVARCHAR(100)    NOT NULL,
     team            NVARCHAR(2)      NOT NULL CHECK (team IN ('CA','DS','NA')),
     role            NVARCHAR(20)     NOT NULL DEFAULT 'member'
                                      CHECK (role IN ('member','admin','platform_admin','super_admin')),
     status          NVARCHAR(20)     NOT NULL DEFAULT 'pending'
                                      CHECK (status IN ('pending','active','rejected','deactivated')),
     avatar_initials NVARCHAR(4)      NOT NULL DEFAULT '',
     last_login_at   DATETIME2        NULL,
     created_at      DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
     updated_at      DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
     UNIQUE (env_id, email)  -- email unique per environment
   );`,

  // ── 3. Refresh Tokens ─────────────────────────────────────────────────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='refresh_tokens' AND xtype='U')
   CREATE TABLE refresh_tokens (
     id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     user_id     UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     token_hash  NVARCHAR(255)    NOT NULL,
     expires_at  DATETIME2        NOT NULL,
     created_at  DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,

  // ── 4. Projects ───────────────────────────────────────────────────────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='projects' AND xtype='U')
   CREATE TABLE projects (
     id             UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     env_id         UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
     name           NVARCHAR(200)    NOT NULL,
     description    NVARCHAR(MAX)    NOT NULL,
     objectives     NVARCHAR(MAX)    NOT NULL,
     domain         NVARCHAR(10)     NOT NULL DEFAULT 'JOINT'
                                     CHECK (domain IN ('CA','DS','JOINT')),
     status         NVARCHAR(20)     NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('draft','pending','active','rejected','completed','archived')),
     initiated_by   UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
     start_date     DATE             NULL,
     end_date       DATE             NULL,
     rejection_note NVARCHAR(MAX)    NULL,
     approved_by    UNIQUEIDENTIFIER NULL REFERENCES users(id),
     approved_at    DATETIME2        NULL,
     created_at     DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
     updated_at     DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,
  `IF EXISTS (SELECT * FROM sysobjects WHERE name='projects' AND xtype='U')
   AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('projects') AND name = 'domain')
   BEGIN
     ALTER TABLE projects ADD domain NVARCHAR(10) NOT NULL DEFAULT 'JOINT';
   END`,
  `IF EXISTS (SELECT * FROM sysobjects WHERE name='projects' AND xtype='U')
   AND EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('projects') AND name = 'domain')
   AND NOT EXISTS (
     SELECT * FROM sys.check_constraints
     WHERE parent_object_id = OBJECT_ID('projects')
       AND name = 'CK_projects_domain'
   )
   BEGIN
     EXEC('ALTER TABLE projects ADD CONSTRAINT CK_projects_domain CHECK (domain IN (''CA'',''DS'',''JOINT''));');
   END`,

  // ── 5. Project Milestones ─────────────────────────────────────────────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='project_milestones' AND xtype='U')
   CREATE TABLE project_milestones (
     id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     project_id   UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     title        NVARCHAR(200)    NOT NULL,
     due_date     DATE             NOT NULL,
     is_completed BIT              NOT NULL DEFAULT 0,
     created_at   DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,

  // ── 6. Project Members ────────────────────────────────────────────────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='project_members' AND xtype='U')
   CREATE TABLE project_members (
     id         UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     project_id UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     user_id    UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
     added_at   DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
     is_active  BIT              NOT NULL DEFAULT 1,
     UNIQUE (project_id, user_id)
   );`,

  // ── 7. Project Features (workspace tools enabled per project) ─────────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='project_features' AND xtype='U')
   CREATE TABLE project_features (
     id         UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     project_id UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     feature    NVARCHAR(50)     NOT NULL,   -- 'annotations','knowledge_hub','reporting',etc.
     UNIQUE (project_id, feature)
   );`,

  // ── 8. Project Messages (workspace chat) ──────────────────────────────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='project_messages' AND xtype='U')
   CREATE TABLE project_messages (
     id         UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     project_id UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id),
     sender_id  UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
     content    NVARCHAR(MAX)    NOT NULL,
     sent_at    DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,

  // ── 9. Project Files ──────────────────────────────────────────────────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='project_files' AND xtype='U')
   CREATE TABLE project_files (
     id            UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     project_id    UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id),
     uploaded_by   UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
     file_name     NVARCHAR(255)    NOT NULL,
     original_name NVARCHAR(255)    NOT NULL,
     file_size     BIGINT           NOT NULL,
     mime_type     NVARCHAR(100)    NOT NULL,
     file_path     NVARCHAR(500)    NOT NULL,
     uploaded_at   DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,

  // ── 10. Tasks ─────────────────────────────────────────────────────────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='tasks' AND xtype='U')
   CREATE TABLE tasks (
     id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     project_id   UNIQUEIDENTIFIER NULL REFERENCES projects(id),
     env_id       UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
     title        NVARCHAR(200)    NOT NULL,
     description  NVARCHAR(MAX)    NULL,
     priority     NVARCHAR(10)     NOT NULL DEFAULT 'Medium'
                                  CHECK (priority IN ('High','Medium','Low','Critical')),
     status       NVARCHAR(20)     NOT NULL DEFAULT 'todo'
                                  CHECK (status IN ('todo','in_progress','in_review','done')),
     type         NVARCHAR(30)     NOT NULL DEFAULT 'OTHER',
     assigned_to  UNIQUEIDENTIFIER NULL REFERENCES users(id),
     created_by   UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
     due_date     DATE             NULL,
     completed_at DATETIME2        NULL,
     force_closed_reason NVARCHAR(MAX) NULL,
     closed_by    UNIQUEIDENTIFIER NULL REFERENCES users(id),
     created_at   DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
     updated_at   DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,

  // ── 11. KPI Records ───────────────────────────────────────────────────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='kpi_records' AND xtype='U')
   CREATE TABLE kpi_records (
     id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     project_id   UNIQUEIDENTIFIER NULL REFERENCES projects(id),
     env_id       UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
     user_id      UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
     domain       NVARCHAR(10)     NOT NULL DEFAULT 'CA' CHECK (domain IN ('CA','DS')),
     metric_key   NVARCHAR(100)    NOT NULL,   -- e.g. 'report_accuracy','model_accuracy'
     metric_value DECIMAL(10,4)    NOT NULL,
     unit         NVARCHAR(20)     NOT NULL DEFAULT '%',
     target_value DECIMAL(10,4)    NULL,
     source       NVARCHAR(20)     NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','AUTO_INGESTED')),
     period_label NVARCHAR(50)     NULL,
     period_start DATE             NOT NULL,
     period_end   DATE             NOT NULL,
     recorded_at  DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,

  // ── 12. KPI Thresholds (admin-configurable, no code change needed) ────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='kpi_thresholds' AND xtype='U')
   CREATE TABLE kpi_thresholds (
     id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     env_id      UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
     metric_key  NVARCHAR(100)    NOT NULL,
     min_value   DECIMAL(10,4)    NOT NULL,
     team        NVARCHAR(2)      NOT NULL CHECK (team IN ('CA','DS')),
     updated_by  UNIQUEIDENTIFIER NULL REFERENCES users(id),
     updated_at  DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
     UNIQUE (env_id, metric_key, team)
   );`,

  // ── 13. Audit Logs ────────────────────────────────────────────────────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='audit_logs' AND xtype='U')
   CREATE TABLE audit_logs (
     id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     env_id      UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
     actor_id    UNIQUEIDENTIFIER NULL REFERENCES users(id),
     action_type NVARCHAR(80)     NOT NULL,  -- e.g. 'file_upload','task_update','user_approved'
     target_type NVARCHAR(50)     NULL,      -- 'file','task','user','project','message'
     target_id   NVARCHAR(100)    NULL,
     target_name NVARCHAR(255)    NULL,
     metadata    NVARCHAR(MAX)    NULL,      -- JSON blob for extra context
     ip_address  NVARCHAR(45)     NULL,
     created_at  DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,

  // ── 14. Notifications ─────────────────────────────────────────────────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='notifications' AND xtype='U')
   CREATE TABLE notifications (
     id         UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     user_id    UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     type       NVARCHAR(50)     NOT NULL,   -- 'access_approved','access_rejected','project_approved',etc.
     title      NVARCHAR(200)    NOT NULL,
     body       NVARCHAR(MAX)    NOT NULL,
     is_read    BIT              NOT NULL DEFAULT 0,
     ref_id     NVARCHAR(100)    NULL,       -- related entity id
     created_at DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,

  // ── 15. Project History (for blueprint 3.2.3) ──────────────────────────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='project_history' AND xtype='U')
   CREATE TABLE project_history (
     id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     project_id   UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     changed_by   UNIQUEIDENTIFIER NULL REFERENCES users(id),
     change_type  NVARCHAR(50)     NOT NULL,   -- 'created','updated','approved','rejected','member_added',etc.
     field_name   NVARCHAR(100)    NULL,       -- which field changed
     old_value    NVARCHAR(MAX)    NULL,
     new_value    NVARCHAR(MAX)    NULL,
     change_note  NVARCHAR(MAX)    NULL,       -- optional note
     changed_at   DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,

  // ── 16. Project Approvals (for dual-admin approval workflow) ───────────
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='project_approvals' AND xtype='U')
   CREATE TABLE project_approvals (
     id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     project_id   UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     admin_id     UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
     admin_team   NVARCHAR(2)      NOT NULL CHECK (admin_team IN ('CA','DS')),
     approved_at  DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
     notes        NVARCHAR(MAX)    NULL,
     UNIQUE (project_id, admin_team)
   );`,
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='kpi_dashboard_layouts' AND xtype='U')
   CREATE TABLE kpi_dashboard_layouts (
     id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     env_id      UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
     user_id     UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     layout_json NVARCHAR(MAX)    NOT NULL,
     created_at  DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
     updated_at  DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
     UNIQUE (env_id, user_id)
   );`,
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='kpi_insight_notes' AND xtype='U')
   CREATE TABLE kpi_insight_notes (
     id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     env_id       UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
     project_id   UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     pair_key     NVARCHAR(200)    NOT NULL,
     period_label NVARCHAR(50)     NULL,
     note         NVARCHAR(MAX)    NOT NULL,
     author_id    UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
     created_at   DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='task_peer_ratings' AND xtype='U')
   CREATE TABLE task_peer_ratings (
     id            UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     env_id        UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
     task_id       UNIQUEIDENTIFIER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     rater_id      UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
     rated_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
     rating        INT              NOT NULL CHECK (rating BETWEEN 1 AND 5),
     note          NVARCHAR(1000)   NULL,
     created_at    DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='task_comments' AND xtype='U')
   CREATE TABLE task_comments (
     id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     task_id      UNIQUEIDENTIFIER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     author_id    UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
     comment_text NVARCHAR(MAX)    NOT NULL,
     created_at   DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='task_dependencies' AND xtype='U')
   CREATE TABLE task_dependencies (
     id                 UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     env_id             UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
     project_id         UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     task_id            UNIQUEIDENTIFIER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     depends_on_task_id UNIQUEIDENTIFIER NOT NULL REFERENCES tasks(id),
     created_at         DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
     UNIQUE (task_id, depends_on_task_id)
   );`,
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='project_file_versions' AND xtype='U')
   CREATE TABLE project_file_versions (
     id             UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     file_id        UNIQUEIDENTIFIER NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
     version_number NVARCHAR(20)     NOT NULL,
     output_type    NVARCHAR(30)     NULL,
     change_note    NVARCHAR(MAX)    NULL,
     file_path      NVARCHAR(500)    NOT NULL,
     file_size      BIGINT           NOT NULL,
     mime_type      NVARCHAR(100)    NOT NULL,
     published_by   UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
     published_at   DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='regulatory_rules' AND xtype='U')
   CREATE TABLE regulatory_rules (
     id                   UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     env_id               UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
     project_id           UNIQUEIDENTIFIER NULL REFERENCES projects(id) ON DELETE CASCADE,
     field_name           NVARCHAR(100)    NOT NULL,
     operator             NVARCHAR(10)     NOT NULL CHECK (operator IN ('GT','LT','EQ','NEQ')),
     threshold_value      DECIMAL(18,4)    NOT NULL,
     severity             NVARCHAR(10)     NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
     description          NVARCHAR(MAX)    NOT NULL,
     regulatory_reference NVARCHAR(255)    NULL,
     created_by           UNIQUEIDENTIFIER NULL REFERENCES users(id),
     created_at           DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='constraint_breach_logs' AND xtype='U')
   CREATE TABLE constraint_breach_logs (
     id                    UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     env_id                UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
     project_id            UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     file_id               UNIQUEIDENTIFIER NULL REFERENCES project_files(id),
     version_id            UNIQUEIDENTIFIER NULL REFERENCES project_file_versions(id),
     field_name            NVARCHAR(100)    NULL,
     severity              NVARCHAR(10)     NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
     description           NVARCHAR(MAX)    NOT NULL,
     regulatory_reference  NVARCHAR(255)    NULL,
     status                NVARCHAR(20)     NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
     resolution_plan       NVARCHAR(MAX)    NULL,
     corrective_version_id UNIQUEIDENTIFIER NULL REFERENCES project_file_versions(id),
     resolved_by           UNIQUEIDENTIFIER NULL REFERENCES users(id),
     resolved_at           DATETIME2        NULL,
     created_by            UNIQUEIDENTIFIER NULL REFERENCES users(id),
     created_at            DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,
  `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='advancement_recommendations' AND xtype='U')
   CREATE TABLE advancement_recommendations (
     id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
     env_id              UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
     user_id             UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     recommended_by      UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
     recommendation_text NVARCHAR(MAX)    NOT NULL,
     evidence_json       NVARCHAR(MAX)    NULL,
     advancement_type    NVARCHAR(100)    NOT NULL,
     created_at          DATETIME2        NOT NULL DEFAULT GETUTCDATE()
   );`,
  `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_users_env_email')
     CREATE INDEX IX_users_env_email ON users(env_id, email);
   IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_audit_logs_env_created')
     CREATE INDEX IX_audit_logs_env_created ON audit_logs(env_id, created_at DESC);
   IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_audit_logs_actor')
     CREATE INDEX IX_audit_logs_actor ON audit_logs(actor_id, created_at DESC);
   IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_notifications_user_read')
     CREATE INDEX IX_notifications_user_read ON notifications(user_id, is_read, created_at DESC);
   IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_project_messages_project')
     CREATE INDEX IX_project_messages_project ON project_messages(project_id, sent_at DESC);
   IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_kpi_records_user_period')
     CREATE INDEX IX_kpi_records_user_period ON kpi_records(user_id, period_start, period_end);
   IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_project_history_project')
     CREATE INDEX IX_project_history_project ON project_history(project_id, changed_at DESC);`,
];

async function runMigrations() {
  let masterPool;
  let dbPool;
  try {
    console.log('\n🔌 Connecting to SQL Server...');
    console.log(`   Server  : ${config.server}:${config.port}`);
    console.log(`   User    : ${config.user}`);
    console.log(`   DB Name : ${process.env.DB_NAME}`);
    console.log(`   Encrypt : ${config.options.encrypt}\n`);

    // Step 1: Connect to master to create DB if needed
    masterPool = await new sql.ConnectionPool({ ...config, database: 'master' }).connect();
    console.log('✅ Connected to SQL Server (master)');

    process.stdout.write(`   Running migration 1/${migrations.length} (create DB)... `);
    await masterPool.request().query(migrations[0]);
    console.log('done');
    await masterPool.close();
    masterPool = null;

    // Step 2: Connect directly to the target database for all remaining migrations
    dbPool = await new sql.ConnectionPool({ ...config, database: process.env.DB_NAME }).connect();
    console.log(`✅ Connected to [${process.env.DB_NAME}]\n`);

    for (let i = 1; i < migrations.length; i++) {
      process.stdout.write(`   Running migration ${i + 1}/${migrations.length}... `);
      await dbPool.request().query(migrations[i]);
      console.log('done');
    }

    console.log('\n✅ All migrations completed successfully.\n');
    await dbPool.close();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Migration failed!\n');
    console.error('Error code    :', err.code    || 'N/A');
    console.error('Error number  :', err.number  || 'N/A');
    console.error('Error message :', err.message || err);

    if (err.code === 'ELOGIN' || err.message?.includes('Login failed')) {
      console.error('\n🔑 FIX: Wrong username/password in server/.env');
      console.error('   → Check DB_USER and DB_PASSWORD');
      console.error('   → Make sure SQL Server Authentication is enabled (not just Windows Auth)');
    }
    if (err.code === 'ESOCKET' || err.code === 'ECONNREFUSED' || err.message?.includes('connect')) {
      console.error('\n🔌 FIX: Cannot reach SQL Server');
      console.error('   → Is SQL Server running? Check Windows Services → "SQL Server (MSSQLSERVER)"');
      console.error('   → Is TCP/IP enabled? Open SQL Server Configuration Manager → SQL Server Network Configuration → Protocols → Enable TCP/IP');
      console.error('   → Is port 1433 open? Run: netstat -an | findstr 1433');
      console.error('   → Try DB_SERVER=127.0.0.1 instead of localhost in .env');
    }
    if (err.message?.includes('certificate') || err.message?.includes('SSL')) {
      console.error('\n🔒 FIX: SSL/Certificate issue');
      console.error('   → Make sure DB_TRUST_SERVER_CERT=true is in server/.env');
      console.error('   → Make sure DB_ENCRYPT=false is in server/.env');
    }
    if (err.message?.includes('named instance') || err.message?.includes('EINSTLOOKUP')) {
      console.error('\n📛 FIX: Named instance issue');
      console.error('   → Your SQL Server may be installed as a named instance (e.g. SQLEXPRESS)');
      console.error('   → Change DB_SERVER=localhost\\SQLEXPRESS in server/.env');
      console.error('   → Or DB_SERVER=.\\SQLEXPRESS');
    }

    console.error('\n📋 Full error stack:\n', err.stack || err);
    if (masterPool) try { await masterPool.close(); } catch {}
    if (dbPool) try { await dbPool.close(); } catch {}
    process.exit(1);
  }
}

runMigrations();