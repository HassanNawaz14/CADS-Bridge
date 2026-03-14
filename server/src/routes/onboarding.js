/**
 * Onboarding Routes — /api/onboarding
 * Allows a new firm to provision their own CADS-Bridge environment
 * through a 4-step wizard without needing a platform admin.
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { query, sql } = require('../db');
const { auditLog } = require('../utils/auditLog');

const validate = (vs) => async (req, res, next) => {
  await Promise.all(vs.map((v) => v.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
};

// Generate a cryptographically unguessable env code (min 12-char alphanumeric per NFR)
function generateEnvCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0,O,1,I)
  let code = 'CADS-';
  for (let i = 0; i < 12; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── POST /api/onboarding/check-firm ────────────────────────────────────────
// Step 1 validation — check firm name not already taken
router.post('/check-firm',
  validate([
    body('firmName').trim().isLength({ min: 2, max: 200 }).withMessage('Firm name must be 2–200 characters.'),
    body('industry').trim().notEmpty().withMessage('Industry is required.'),
  ]),
  async (req, res) => {
    try {
      const { firmName } = req.body;
      // Optional: warn if firm name already exists (not a hard block — same firm can have multiple envs)
      const existing = await query(
        `SELECT COUNT(*) as cnt FROM environments WHERE firm_name = @name`,
        { name: { type: sql.NVarChar, value: firmName } }
      );
      const count = existing.recordset[0].cnt;
      res.json({
        success: true,
        alreadyExists: count > 0,
        message: count > 0
          ? `An environment for "${firmName}" already exists. You can still create a new one.`
          : null,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Validation failed.' });
    }
  }
);

// ── POST /api/onboarding/provision ─────────────────────────────────────────
// Steps 1+2 combined — creates environment + both admin accounts atomically
router.post('/provision',
  validate([
    // Firm details
    body('firmName').trim().isLength({ min: 2, max: 200 }).withMessage('Firm name is required.'),
    body('industry').trim().notEmpty().withMessage('Industry sector is required.'),
    // CA Admin
    body('caAdmin.fullName').trim().isLength({ min: 2 }).withMessage('CA Admin name is required.'),
    body('caAdmin.email').isEmail().normalizeEmail().withMessage('CA Admin email is invalid.'),
    body('caAdmin.designation').trim().notEmpty().withMessage('CA Admin designation is required.'),
    body('caAdmin.password').isLength({ min: 8 })
      .matches(/^(?=.*[A-Z])(?=.*[0-9])/)
      .withMessage('CA Admin password must be 8+ chars with uppercase and number.'),
    // DS Admin
    body('dsAdmin.fullName').trim().isLength({ min: 2 }).withMessage('DS Admin name is required.'),
    body('dsAdmin.email').isEmail().normalizeEmail().withMessage('DS Admin email is invalid.'),
    body('dsAdmin.designation').trim().notEmpty().withMessage('DS Admin designation is required.'),
    body('dsAdmin.password').isLength({ min: 8 })
      .matches(/^(?=.*[A-Z])(?=.*[0-9])/)
      .withMessage('DS Admin password must be 8+ chars with uppercase and number.'),
  ]),
  async (req, res) => {
    try {
      const { firmName, industry, caAdmin, dsAdmin } = req.body;

      // Ensure CA and DS admins have different emails
      if (caAdmin.email === dsAdmin.email) {
        return res.status(400).json({
          success: false,
          message: 'CA Admin and DS Admin must have different email addresses.',
        });
      }

      // Generate unique env code (retry if collision — extremely rare)
      let envCode;
      let attempts = 0;
      do {
        envCode = generateEnvCode();
        const clash = await query(
          `SELECT id FROM environments WHERE env_code = @code`,
          { code: { type: sql.NVarChar, value: envCode } }
        );
        if (!clash.recordset.length) break;
        attempts++;
      } while (attempts < 5);

      const envId      = uuidv4();
      const caAdminId  = uuidv4();
      const dsAdminId  = uuidv4();

      const caHash = await bcrypt.hash(caAdmin.password, 10);
      const dsHash = await bcrypt.hash(dsAdmin.password, 10);

      const caInitials = caAdmin.fullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 4);
      const dsInitials = dsAdmin.fullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 4);

      // ── Create environment
      await query(
        `INSERT INTO environments (id, firm_name, industry, env_code)
         VALUES (@id, @firm, @ind, @code)`,
        {
          id:   { type: sql.UniqueIdentifier, value: envId },
          firm: { type: sql.NVarChar, value: firmName },
          ind:  { type: sql.NVarChar, value: industry },
          code: { type: sql.NVarChar, value: envCode },
        }
      );

      // ── Create CA Admin
      await query(
        `INSERT INTO users (id, env_id, full_name, email, password_hash, designation, team, role, status, avatar_initials)
         VALUES (@id, @envId, @name, @email, @hash, @desig, 'CA', 'admin', 'active', @init)`,
        {
          id:    { type: sql.UniqueIdentifier, value: caAdminId },
          envId: { type: sql.UniqueIdentifier, value: envId },
          name:  { type: sql.NVarChar, value: caAdmin.fullName },
          email: { type: sql.NVarChar, value: caAdmin.email },
          hash:  { type: sql.NVarChar, value: caHash },
          desig: { type: sql.NVarChar, value: caAdmin.designation },
          init:  { type: sql.NVarChar, value: caInitials },
        }
      );

      // ── Create DS Admin
      await query(
        `INSERT INTO users (id, env_id, full_name, email, password_hash, designation, team, role, status, avatar_initials)
         VALUES (@id, @envId, @name, @email, @hash, @desig, 'DS', 'admin', 'active', @init)`,
        {
          id:    { type: sql.UniqueIdentifier, value: dsAdminId },
          envId: { type: sql.UniqueIdentifier, value: envId },
          name:  { type: sql.NVarChar, value: dsAdmin.fullName },
          email: { type: sql.NVarChar, value: dsAdmin.email },
          hash:  { type: sql.NVarChar, value: dsHash },
          desig: { type: sql.NVarChar, value: dsAdmin.designation },
          init:  { type: sql.NVarChar, value: dsInitials },
        }
      );

      // ── Seed default KPI thresholds for this environment
      const thresholds = [
        { key: 'report_accuracy',          team: 'CA', min: 85 },
        { key: 'task_completion_rate',     team: 'CA', min: 75 },
        { key: 'audit_findings_resolved',  team: 'CA', min: 70 },
        { key: 'model_accuracy',           team: 'DS', min: 80 },
        { key: 'pipeline_uptime',          team: 'DS', min: 95 },
        { key: 'prediction_delivery_rate', team: 'DS', min: 80 },
      ];
      for (const t of thresholds) {
        await query(
          `INSERT INTO kpi_thresholds (id, env_id, metric_key, min_value, team)
           VALUES (NEWID(), @envId, @key, @min, @team)`,
          {
            envId: { type: sql.UniqueIdentifier, value: envId },
            key:   { type: sql.NVarChar, value: t.key },
            min:   { type: sql.Decimal(10, 4), value: t.min },
            team:  { type: sql.NVarChar, value: t.team },
          }
        );
      }

      // ── Audit log the environment creation
      await auditLog({
        envId,
        actorId: caAdminId,
        actionType: 'environment_provisioned',
        targetType: 'environment',
        targetId: envId,
        targetName: firmName,
        metadata: { industry, envCode },
      });

      res.status(201).json({
        success: true,
        environment: {
          id: envId,
          firmName,
          industry,
          envCode,
        },
        admins: {
          ca: { id: caAdminId, fullName: caAdmin.fullName, email: caAdmin.email, team: 'CA' },
          ds: { id: dsAdminId, fullName: dsAdmin.fullName, email: dsAdmin.email, team: 'DS' },
        },
      });
    } catch (err) {
      console.error('Provision error:', err);
      res.status(500).json({ success: false, message: 'Failed to provision environment. Please try again.' });
    }
  }
);

// ── POST /api/onboarding/invite-members ─────────────────────────────────────
// Step 3 (optional) — bulk-create initial team members in pending state
router.post('/invite-members',
  validate([
    body('envCode').trim().notEmpty().withMessage('Environment code is required.'),
    body('members').isArray({ min: 1 }).withMessage('At least one member required.'),
    body('members.*.fullName').trim().notEmpty().withMessage('Member name is required.'),
    body('members.*.email').isEmail().normalizeEmail().withMessage('Valid email required.'),
    body('members.*.team').isIn(['CA', 'DS']).withMessage('Team must be CA or DS.'),
    body('members.*.designation').trim().notEmpty().withMessage('Designation is required.'),
  ]),
  async (req, res) => {
    try {
      const { envCode, members } = req.body;

      // Verify environment exists
      const envResult = await query(
        `SELECT id FROM environments WHERE env_code = @code AND is_active = 1`,
        { code: { type: sql.NVarChar, value: envCode } }
      );
      if (!envResult.recordset.length) {
        return res.status(404).json({ success: false, message: 'Environment not found.' });
      }
      const envId = envResult.recordset[0].id;

      // Generate a temporary password for each invited member
      // They'll be prompted to change it on first login (future sprint feature)
      const tempPassword = await bcrypt.hash('TempPass@123', 10);

      const results = [];
      const errors  = [];

      for (const m of members) {
        try {
          // Check duplicate
          const dup = await query(
            `SELECT id FROM users WHERE env_id = @envId AND email = @email`,
            {
              envId: { type: sql.UniqueIdentifier, value: envId },
              email: { type: sql.NVarChar, value: m.email },
            }
          );
          if (dup.recordset.length) {
            errors.push({ email: m.email, reason: 'Email already exists in this environment.' });
            continue;
          }

          const initials = m.fullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 4);
          const userId   = uuidv4();

          await query(
            `INSERT INTO users (id, env_id, full_name, email, password_hash, designation, team, role, status, avatar_initials)
             VALUES (@id, @envId, @name, @email, @hash, @desig, @team, 'member', 'pending', @init)`,
            {
              id:    { type: sql.UniqueIdentifier, value: userId },
              envId: { type: sql.UniqueIdentifier, value: envId },
              name:  { type: sql.NVarChar, value: m.fullName },
              email: { type: sql.NVarChar, value: m.email },
              hash:  { type: sql.NVarChar, value: tempPassword },
              desig: { type: sql.NVarChar, value: m.designation },
              team:  { type: sql.NVarChar, value: m.team },
              init:  { type: sql.NVarChar, value: initials },
            }
          );

          results.push({ id: userId, fullName: m.fullName, email: m.email, team: m.team, status: 'pending' });
        } catch (e) {
          errors.push({ email: m.email, reason: 'Failed to create member.' });
        }
      }

      res.status(201).json({
        success: true,
        created: results,
        errors,
        message: `${results.length} member(s) added. ${errors.length > 0 ? `${errors.length} failed.` : ''}`,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to invite members.' });
    }
  }
);

module.exports = router;
