require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const IS_VERCEL = process.env.VERCEL === '1';

const logger = require('./utils/logger');
const { getPool } = require('./db');
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

  server = http.createServer(app);

  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.envId  = decoded.envId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug(`Socket connected: user ${socket.userId}`);
    socket.join(`user:${socket.userId}`);

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
app.use('/api/projects/:projectId/messages', workspaceRoutes);
app.use('/api/projects/:projectId/files',    workspaceRoutes);
app.use('/api/tasks',         tasksRoutes);
app.use('/api/kpi',           kpiRoutes);
app.use('/api/notifications', notifRoutes);

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

  const startServer = async () => {
    try {
      await getPool(); // Verify DB connection on startup
      server.listen(PORT, () => {
        logger.info(`🚀 CADS-Bridge server running on port ${PORT}`);
        logger.info(`📡 Socket.IO ready`);
        logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
      });
    } catch (err) {
      logger.error('Failed to start server:', err.message);
      process.exit(1);
    }
  };

  startServer();
}

// Export for Vercel serverless
module.exports = app;
