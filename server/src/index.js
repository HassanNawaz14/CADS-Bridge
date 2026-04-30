require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const IS_VERCEL = process.env.VERCEL === '1';

const logger = require('./utils/logger');
const { getPool, query } = require('./db');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// ── Route imports ──────────────────────────────────────────────────────────
const authRoutes         = require('./routes/auth');
const adminRoutes        = require('./routes/admin');
const projectRoutes      = require('./routes/projects');
const workspaceRoutes    = require('./routes/workspace');
const tasksRoutes        = require('./routes/tasks');
const kpiRoutes          = require('./routes/kpi');
const notifRoutes        = require('./routes/notifications');
const onboardingRoutes   = require('./routes/onboarding');
const knowledgeHubRoutes = require('./routes/knowledgeHub');
const conflictRoutes     = require('./routes/conflicts');

const app = express();

// ── Ensure upload / log dirs exist (local dev only) ──────────────────────
if (!IS_VERCEL) {
  const fs = require('fs');
  ['uploads', 'logs'].forEach((dir) => {
    fs.mkdirSync(path.join(__dirname, '..', dir), { recursive: true });
  });
}

// ── Socket.IO (local dev only — Vercel serverless doesn't support WebSockets) ──
let server = null;
let io = null;

if (!IS_VERCEL) {
  const http = require('http');
  const { Server } = require('socket.io');
  const jwt = require('jsonwebtoken');
  const WorkspaceSocket = require('./websocket/workspaceSocket');

  server = http.createServer(app);

  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Initialize workspace socket functionality
  const workspaceSocket = new WorkspaceSocket(io);

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.envId  = decoded.envId;
      socket.userRole = decoded.role;
      socket.userTeam = decoded.team;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug(`Socket connected: user ${socket.userId}`);
    socket.join(`user:${socket.userId}`);

    // Legacy project events (for backward compatibility)
    socket.on('join_project', (projectId) => {
      socket.join(`project:${projectId}`);
      logger.debug(`User ${socket.userId} joined project:${projectId}`);
    });

    socket.on('leave_project', (projectId) => {
      socket.leave(`project:${projectId}`);
    });

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: user ${socket.userId}`);
    });
  });
}

// Make io accessible in routes (will be null on Vercel — routes handle this gracefully)
app.set('io', io);

// ── Security middleware ────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow file downloads
}));

const clientUrl = process.env.CLIENT_URL ? process.env.CLIENT_URL.replace(/\/$/, '') : 'http://localhost:3000';
app.use(cors({
  origin: [clientUrl, `${clientUrl}/`], // Allow both with and without trailing slash
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting — 200 req/15min per IP (general), stricter for auth
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' },
});

app.use(generalLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy (for correct IP in audit logs behind nginx/load balancer)
app.set('trust proxy', 1);

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',          authLimiter, authRoutes);
app.use('/api/onboarding',   onboardingRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/projects',      projectRoutes);
app.use('/api/projects/:projectId', workspaceRoutes);
app.use('/api/projects/:projectId/messages', workspaceRoutes);
app.use('/api/projects/:projectId/files',    workspaceRoutes);
app.use('/api/tasks',         tasksRoutes);
app.use('/api/kpi',           kpiRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/knowledge-hub', knowledgeHubRoutes);
app.use('/api/conflicts',      conflictRoutes);

// Static file serving for uploads (protected via auth middleware in download route)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'healthy', timestamp: new Date().toISOString() });
});

// ── Error handling ─────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start server (local dev) or export for Vercel ─────────────────────────
if (!IS_VERCEL && server) {
  const PORT = process.env.PORT || 5000;

  const ensureSchema = async () => {
    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='projects' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('projects') AND name = 'domain')
               BEGIN
                 ALTER TABLE projects ADD domain NVARCHAR(10) NOT NULL DEFAULT 'JOINT';
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='projects' AND xtype='U')
                 AND EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('projects') AND name = 'domain')
                 AND NOT EXISTS (
                   SELECT *
                   FROM sys.check_constraints
                   WHERE parent_object_id = OBJECT_ID('projects')
                     AND name = 'CK_projects_domain'
                 )
               BEGIN
                 EXEC('ALTER TABLE projects ADD CONSTRAINT CK_projects_domain CHECK (domain IN (''CA'',''DS'',''JOINT''));');
               END`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='project_approvals' AND xtype='U')
               CREATE TABLE project_approvals (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 project_id UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                 admin_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
                 admin_team NVARCHAR(2) NOT NULL CHECK (admin_team IN ('CA','DS')),
                 approved_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
                 notes NVARCHAR(MAX) NULL,
                 UNIQUE (project_id, admin_team)
               );`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='kpi_records' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('kpi_records') AND name = 'project_id')
               BEGIN
                 ALTER TABLE kpi_records ADD project_id UNIQUEIDENTIFIER NULL REFERENCES projects(id);
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='kpi_records' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('kpi_records') AND name = 'domain')
               BEGIN
                 ALTER TABLE kpi_records ADD domain NVARCHAR(10) NOT NULL DEFAULT 'CA';
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='kpi_records' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('kpi_records') AND name = 'source')
               BEGIN
                 ALTER TABLE kpi_records ADD source NVARCHAR(20) NOT NULL DEFAULT 'MANUAL';
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='kpi_records' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('kpi_records') AND name = 'unit')
               BEGIN
                 ALTER TABLE kpi_records ADD unit NVARCHAR(20) NOT NULL DEFAULT '%';
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='kpi_records' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('kpi_records') AND name = 'target_value')
               BEGIN
                 ALTER TABLE kpi_records ADD target_value DECIMAL(10,4) NULL;
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='kpi_records' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('kpi_records') AND name = 'period_label')
               BEGIN
                 ALTER TABLE kpi_records ADD period_label NVARCHAR(50) NULL;
               END`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='kpi_dashboard_layouts' AND xtype='U')
               CREATE TABLE kpi_dashboard_layouts (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 env_id UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
                 user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                 layout_json NVARCHAR(MAX) NOT NULL,
                 created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
                 updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
                 UNIQUE (env_id, user_id)
               );`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='kpi_insight_notes' AND xtype='U')
               CREATE TABLE kpi_insight_notes (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 env_id UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
                 project_id UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                 pair_key NVARCHAR(200) NOT NULL,
                 period_label NVARCHAR(50) NULL,
                 note NVARCHAR(MAX) NOT NULL,
                 author_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
                 created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
               );`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='task_peer_ratings' AND xtype='U')
               CREATE TABLE task_peer_ratings (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 env_id UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
                 task_id UNIQUEIDENTIFIER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                 rater_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
                 rated_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
                 rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
                 note NVARCHAR(1000) NULL,
                 created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
               );`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='advancement_recommendations' AND xtype='U')
               CREATE TABLE advancement_recommendations (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 env_id UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
                 user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                 recommended_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
                 recommendation_text NVARCHAR(MAX) NOT NULL,
                 evidence_json NVARCHAR(MAX) NULL,
                 advancement_type NVARCHAR(100) NOT NULL,
                 created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
               );`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='tasks' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('tasks') AND name = 'type')
               BEGIN
                 ALTER TABLE tasks ADD type NVARCHAR(30) NOT NULL DEFAULT 'OTHER';
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='tasks' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('tasks') AND name = 'force_closed_reason')
               BEGIN
                 ALTER TABLE tasks ADD force_closed_reason NVARCHAR(MAX) NULL;
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='tasks' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('tasks') AND name = 'closed_by')
               BEGIN
                 ALTER TABLE tasks ADD closed_by UNIQUEIDENTIFIER NULL REFERENCES users(id);
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='tasks' AND xtype='U')
               BEGIN
                 DECLARE @statusConstraint NVARCHAR(128);
                 SELECT TOP 1 @statusConstraint = cc.name
                 FROM sys.check_constraints cc
                 WHERE cc.parent_object_id = OBJECT_ID('tasks')
                   AND cc.definition LIKE '%status%'
                   AND cc.definition LIKE '%todo%'
                   AND cc.definition LIKE '%in_progress%'
                   AND cc.definition LIKE '%done%'
                   AND cc.definition NOT LIKE '%in_review%';

                 IF @statusConstraint IS NOT NULL
                 BEGIN
                   DECLARE @sqlDropStatus NVARCHAR(MAX);
                   SET @sqlDropStatus = 'ALTER TABLE tasks DROP CONSTRAINT [' + @statusConstraint + ']';
                   EXEC sp_executesql @sqlDropStatus;
                 END
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='tasks' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('tasks') AND name = 'CK_tasks_status_flow')
               BEGIN
                 EXEC('ALTER TABLE tasks ADD CONSTRAINT CK_tasks_status_flow CHECK (status IN (''todo'',''in_progress'',''in_review'',''done''));');
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='tasks' AND xtype='U')
               BEGIN
                 DECLARE @priorityConstraint NVARCHAR(128);
                 SELECT TOP 1 @priorityConstraint = cc.name
                 FROM sys.check_constraints cc
                 WHERE cc.parent_object_id = OBJECT_ID('tasks')
                   AND cc.definition LIKE '%priority%'
                   AND cc.definition LIKE '%Low%'
                   AND cc.definition LIKE '%Medium%'
                   AND cc.definition LIKE '%High%'
                   AND cc.definition NOT LIKE '%Critical%';

                 IF @priorityConstraint IS NOT NULL
                 BEGIN
                   DECLARE @sqlDropPriority NVARCHAR(MAX);
                   SET @sqlDropPriority = 'ALTER TABLE tasks DROP CONSTRAINT [' + @priorityConstraint + ']';
                   EXEC sp_executesql @sqlDropPriority;
                 END

                 IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('tasks') AND name = 'CK_tasks_priority_flow')
                   EXEC('ALTER TABLE tasks ADD CONSTRAINT CK_tasks_priority_flow CHECK (priority IN (''Low'',''Medium'',''High'',''Critical''));');
               END`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='task_comments' AND xtype='U')
               CREATE TABLE task_comments (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 task_id UNIQUEIDENTIFIER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                 author_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
                 comment_text NVARCHAR(MAX) NOT NULL,
                 created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
               );`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='task_dependencies' AND xtype='U')
               CREATE TABLE task_dependencies (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 env_id UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
                 project_id UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                 task_id UNIQUEIDENTIFIER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                 depends_on_task_id UNIQUEIDENTIFIER NOT NULL REFERENCES tasks(id),
                 created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
                 UNIQUE (task_id, depends_on_task_id)
               );`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='project_file_versions' AND xtype='U')
               CREATE TABLE project_file_versions (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 file_id UNIQUEIDENTIFIER NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
                 version_number NVARCHAR(20) NOT NULL,
                 output_type NVARCHAR(30) NULL,
                 change_note NVARCHAR(MAX) NULL,
                 file_path NVARCHAR(500) NOT NULL,
                 file_size BIGINT NOT NULL,
                 mime_type NVARCHAR(100) NOT NULL,
                 published_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
                 published_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
               );`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='regulatory_rules' AND xtype='U')
               CREATE TABLE regulatory_rules (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 env_id UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
                 project_id UNIQUEIDENTIFIER NULL REFERENCES projects(id) ON DELETE CASCADE,
                 field_name NVARCHAR(100) NOT NULL,
                 operator NVARCHAR(10) NOT NULL CHECK (operator IN ('GT','LT','EQ','NEQ')),
                 threshold_value DECIMAL(18,4) NOT NULL,
                 severity NVARCHAR(10) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
                 description NVARCHAR(MAX) NOT NULL,
                 regulatory_reference NVARCHAR(255) NULL,
                 created_by UNIQUEIDENTIFIER NULL REFERENCES users(id),
                 created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
               );`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='constraint_breach_logs' AND xtype='U')
               CREATE TABLE constraint_breach_logs (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 env_id UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
                 project_id UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                 file_id UNIQUEIDENTIFIER NULL REFERENCES project_files(id),
                 version_id UNIQUEIDENTIFIER NULL REFERENCES project_file_versions(id),
                 field_name NVARCHAR(100) NULL,
                 severity NVARCHAR(10) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
                 description NVARCHAR(MAX) NOT NULL,
                 regulatory_reference NVARCHAR(255) NULL,
                 status NVARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
                 resolution_plan NVARCHAR(MAX) NULL,
                 corrective_version_id UNIQUEIDENTIFIER NULL REFERENCES project_file_versions(id),
                 resolved_by UNIQUEIDENTIFIER NULL REFERENCES users(id),
                 resolved_at DATETIME2 NULL,
                 created_by UNIQUEIDENTIFIER NULL REFERENCES users(id),
                 created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
               );`);

    // Ensure Decision Rationale table exists (used by project completion + Knowledge Hub)
    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='decision_rationale_documents' AND xtype='U')
               CREATE TABLE decision_rationale_documents (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 project_id UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                 document_path NVARCHAR(500) NOT NULL,
                 generated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
                 is_confidential BIT NOT NULL DEFAULT 0
               );`);

    // ── Knowledge Hub (3.6) tables ──────────────────────────────────────
    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='glossary_terms' AND xtype='U')
               CREATE TABLE glossary_terms (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 env_id UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
                 term NVARCHAR(120) NOT NULL,
                 ca_definition NVARCHAR(MAX) NOT NULL,
                 ds_definition NVARCHAR(MAX) NULL,
                 plain_english_description NVARCHAR(MAX) NOT NULL,
                 example_project_id UNIQUEIDENTIFIER NULL REFERENCES projects(id),
                 status NVARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PUBLISHED')),
                 proposed_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
                 approved_by UNIQUEIDENTIFIER NULL REFERENCES users(id),
                 created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
                 updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
                 UNIQUE (env_id, term)
               );`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='guidelines' AND xtype='U')
               CREATE TABLE guidelines (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 env_id UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
                 title NVARCHAR(200) NOT NULL,
                 domain NVARCHAR(10) NOT NULL CHECK (domain IN ('CA','DS','JOINT')),
                 project_type NVARCHAR(120) NULL,
                 tags_json NVARCHAR(MAX) NOT NULL DEFAULT '[]',
                 created_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
                 created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
                 updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
               );`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='guideline_versions' AND xtype='U')
               CREATE TABLE guideline_versions (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 guideline_id UNIQUEIDENTIFIER NOT NULL REFERENCES guidelines(id) ON DELETE CASCADE,
                 version_number INT NOT NULL,
                 content NVARCHAR(MAX) NOT NULL,
                 change_note NVARCHAR(MAX) NULL,
                 created_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
                 created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
                 UNIQUE (guideline_id, version_number)
               );`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='guideline_proposed_edits' AND xtype='U')
               CREATE TABLE guideline_proposed_edits (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 guideline_id UNIQUEIDENTIFIER NOT NULL REFERENCES guidelines(id) ON DELETE CASCADE,
                 proposed_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
                 proposed_content NVARCHAR(MAX) NOT NULL,
                 comment NVARCHAR(MAX) NULL,
                 status NVARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
                 reviewed_by UNIQUEIDENTIFIER NULL REFERENCES users(id),
                 reviewed_at DATETIME2 NULL,
                 created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
               );`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='knowledge_hub_library' AND xtype='U')
               CREATE TABLE knowledge_hub_library (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 env_id UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
                 project_id UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                 file_id UNIQUEIDENTIFIER NULL REFERENCES project_files(id),
                 decision_rationale_id UNIQUEIDENTIFIER NULL REFERENCES decision_rationale_documents(id),
                 domain NVARCHAR(10) NOT NULL CHECK (domain IN ('CA','DS','JOINT')),
                 project_type NVARCHAR(120) NULL,
                 tags_json NVARCHAR(MAX) NOT NULL DEFAULT '[]',
                 key_lessons NVARCHAR(MAX) NOT NULL,
                 published_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
                 published_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
               );`);

    // ── Conflict Detection & Resolution (3.7) tables ───────────────────
    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='conflict_rules' AND xtype='U')
               CREATE TABLE conflict_rules (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 env_id UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
                 project_id UNIQUEIDENTIFIER NULL REFERENCES projects(id) ON DELETE CASCADE,
                 ds_field NVARCHAR(120) NOT NULL,
                 ca_field NVARCHAR(120) NOT NULL,
                 acceptable_variance_percent DECIMAL(10,4) NOT NULL,
                 severity NVARCHAR(10) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
                 is_regulatory_field BIT NOT NULL DEFAULT 0,
                 created_by UNIQUEIDENTIFIER NULL REFERENCES users(id),
                 created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
               );`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='conflict_records' AND xtype='U')
               CREATE TABLE conflict_records (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 env_id UNIQUEIDENTIFIER NOT NULL REFERENCES environments(id),
                 project_id UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                 conflict_rule_id UNIQUEIDENTIFIER NULL REFERENCES conflict_rules(id),
                 field_name NVARCHAR(120) NOT NULL,
                 ds_value DECIMAL(18,4) NOT NULL,
                 ca_actual_value DECIMAL(18,4) NOT NULL,
                 delta DECIMAL(18,4) NOT NULL,
                 delta_percent DECIMAL(18,4) NOT NULL,
                 severity NVARCHAR(10) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
                 period_label NVARCHAR(50) NULL,
                 status NVARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_RESOLUTION','RESOLVED','ESCALATED')),
                 root_cause_category NVARCHAR(40) NULL CHECK (root_cause_category IN ('MODEL_ASSUMPTION_ERROR','DATA_SOURCE_MISMATCH','SCHEMA_CHANGE','CA_DATA_ENTRY_ERROR','EXTERNAL_MARKET_CHANGE','OTHER')),
                 root_cause_note NVARCHAR(MAX) NULL,
                 ca_response_type NVARCHAR(20) NULL CHECK (ca_response_type IN ('CONFIRM','DISPUTE','ESCALATE')),
                 ca_response_note NVARCHAR(MAX) NULL,
                 reconciliation_decision NVARCHAR(MAX) NULL,
                 ca_confirmed BIT NOT NULL DEFAULT 0,
                 ds_confirmed BIT NOT NULL DEFAULT 0,
                 escalated_at DATETIME2 NULL,
                 resolved_at DATETIME2 NULL,
                 resolved_by UNIQUEIDENTIFIER NULL REFERENCES users(id),
                 created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
                 updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
               );`);

    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='conflict_settings' AND xtype='U')
               CREATE TABLE conflict_settings (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 env_id UNIQUEIDENTIFIER NOT NULL UNIQUE REFERENCES environments(id),
                 sla_days INT NOT NULL DEFAULT 5 CHECK (sla_days BETWEEN 1 AND 30),
                 updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
               );`);

    // ── Feature 3.8: Missing project_files columns ──────────────────────
    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='project_files' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('project_files') AND name = 'domain')
               BEGIN
                 ALTER TABLE project_files ADD domain NVARCHAR(10) NOT NULL DEFAULT 'JOINT';
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='project_files' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('project_files') AND name = 'file_type')
               BEGIN
                 ALTER TABLE project_files ADD file_type NVARCHAR(30) NOT NULL DEFAULT 'OTHER';
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='project_files' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('project_files') AND name = 'content')
               BEGIN
                 ALTER TABLE project_files ADD content NVARCHAR(MAX) NULL;
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='project_files' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('project_files') AND name = 'is_locked')
               BEGIN
                 ALTER TABLE project_files ADD is_locked BIT NOT NULL DEFAULT 0;
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='project_files' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('project_files') AND name = 'locked_by')
               BEGIN
                 ALTER TABLE project_files ADD locked_by UNIQUEIDENTIFIER NULL;
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='project_files' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('project_files') AND name = 'lock_expires_at')
               BEGIN
                 ALTER TABLE project_files ADD lock_expires_at DATETIME2 NULL;
               END`);

    // ── Feature 3.8: File collaboration editors table ───────────────────
    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='file_collaboration_editors' AND xtype='U')
               CREATE TABLE file_collaboration_editors (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 file_id UNIQUEIDENTIFIER NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
                 user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
                 cursor_position INT NULL,
                 cursor_color NVARCHAR(20) NULL,
                 last_seen_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
                 UNIQUE (file_id, user_id)
               );`);

    // ── Feature 3.8: Workspace sessions table ───────────────────────────
    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='workspace_sessions' AND xtype='U')
               CREATE TABLE workspace_sessions (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
                 project_id UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                 started_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
                 ended_at DATETIME2 NULL,
                 is_active BIT NOT NULL DEFAULT 1
               );`);

    // ── Feature 3.8: Workspace activity feed table ──────────────────────
    await query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='workspace_activity_feed' AND xtype='U')
               CREATE TABLE workspace_activity_feed (
                 id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
                 project_id UNIQUEIDENTIFIER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                 activity_type NVARCHAR(50) NOT NULL,
                 actor_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
                 target_type NVARCHAR(50) NULL,
                 target_id UNIQUEIDENTIFIER NULL,
                 target_name NVARCHAR(255) NULL,
                 description NVARCHAR(MAX) NULL,
                 metadata NVARCHAR(MAX) NULL,
                 is_visible BIT NOT NULL DEFAULT 1,
                 created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
               );`);

    // ── Feature 3.8: project_members workspace_role column ──────────────
    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='project_members' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('project_members') AND name = 'workspace_role')
               BEGIN
                 ALTER TABLE project_members ADD workspace_role NVARCHAR(30) NOT NULL DEFAULT 'member';
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='project_members' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('project_members') AND name = 'last_message_read')
               BEGIN
                 ALTER TABLE project_members ADD last_message_read DATETIME2 NULL;
               END`);

    await query(`IF EXISTS (SELECT * FROM sysobjects WHERE name='project_members' AND xtype='U')
                 AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('project_members') AND name = 'added_at')
               BEGIN
                 ALTER TABLE project_members ADD added_at DATETIME2 NOT NULL DEFAULT GETUTCDATE();
               END`);
  };

  const startServer = async () => {
    try {
      await getPool(); // Verify DB connection on startup
      await ensureSchema();
      server.listen(PORT, () => {
        logger.info(`🚀 CADS-Bridge server running on port ${PORT}`);
        logger.info(`📡 Socket.IO ready`);
        logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
      });
    } catch (err) {
      logger.error(`Failed to start server: ${err.stack || err.message || err}`);
      process.exit(1);
    }
  };

  startServer();
}

// Export for Vercel serverless
module.exports = app;
