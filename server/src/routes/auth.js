const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { query, sql } = require('../db');
const { authenticate } = require('../middleware/auth');
const { auditLog } = require('../utils/auditLog');
const { notify } = require('../utils/notify');

// ── Validation helpers ──────────────────────────────────────────────────
const validate = (validations) => async (req, res, next) => {
  await Promise.all(validations.map((v) => v.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }
  next();
};

const generateTokens = (userId, envId, role, team) => {
  const accessToken = jwt.sign(
    { userId, envId, role, team },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
  const refreshToken = uuidv4(); // opaque token stored as hash
  return { accessToken, refreshToken };
};

// ── POST /api/auth/check-env ─────────────────────────────────────────────
// Validates environment code and returns firm info
router.post('/check-env', [
  body('envCode').trim().isLength({ min: 12 }).withMessage('Environment code must be at least 12 characters.'),
], validate([
  body('envCode').trim().isLength({ min: 12 }).withMessage('Environment code must be at least 12 characters.'),
]), async (req, res) => {
  try {
    const { envCode } = req.body;
    const result = await query(
      `SELECT id, firm_name, industry FROM environments WHERE env_code = @code AND is_active = 1`,
      { code: { type: sql.NVarChar, value: envCode.toUpperCase() } }
    );
    if (!result.recordset.length) {
      return res.status(404).json({
        success: false,
        message: 'Invalid environment code. Please contact your administrator.',
      });
    }
    res.json({ success: true, environment: result.recordset[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/auth/register ──────────────────────────────────────────────
router.post('/register',
  validate([
    body('envCode').trim().notEmpty().withMessage('Environment code is required.'),
    body('team').isIn(['CA', 'DS']).withMessage('Team must be CA or DS.'),
    body('fullName').trim().isLength({ min: 2, max: 150 }).withMessage('Full name must be 2–150 characters.'),
    body('designation').trim().notEmpty().withMessage('Designation is required.'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required.'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
      .matches(/^(?=.*[A-Z])(?=.*[0-9])/).withMessage('Password must include an uppercase letter and a number.'),
  ]),
  async (req, res) => {
    try {
      const { envCode, team, fullName, designation, email, password } = req.body;

      // Find environment
      const envResult = await query(
        `SELECT id FROM environments WHERE env_code = @code AND is_active = 1`,
        { code: { type: sql.NVarChar, value: envCode.toUpperCase() } }
      );
      if (!envResult.recordset.length) {
        return res.status(400).json({ success: false, message: 'Invalid environment code.' });
      }
      const envId = envResult.recordset[0].id;

      // Check duplicate email within environment
      const dupCheck = await query(
        `SELECT id FROM users WHERE env_id = @envId AND email = @email`,
        {
          envId: { type: sql.UniqueIdentifier, value: envId },
          email: { type: sql.NVarChar, value: email },
        }
      );
      if (dupCheck.recordset.length) {
        return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const initials = fullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 4);

      const result = await query(
        `INSERT INTO users (id, env_id, full_name, email, password_hash, designation, team, role, status, avatar_initials)
         OUTPUT INSERTED.id, INSERTED.full_name, INSERTED.email, INSERTED.team, INSERTED.status, INSERTED.created_at
         VALUES (NEWID(), @envId, @name, @email, @hash, @desig, @team, 'member', 'pending', @initials)`,
        {
          envId:    { type: sql.UniqueIdentifier, value: envId },
          name:     { type: sql.NVarChar, value: fullName },
          email:    { type: sql.NVarChar, value: email },
          hash:     { type: sql.NVarChar, value: passwordHash },
          desig:    { type: sql.NVarChar, value: designation },
          team:     { type: sql.NVarChar, value: team },
          initials: { type: sql.NVarChar, value: initials },
        }
      );

      const newUser = result.recordset[0];

      // Notify all admins of this env
      const adminResult = await query(
        `SELECT id FROM users WHERE env_id = @envId AND role IN ('admin','platform_admin') AND status = 'active' AND team = @team`,
        {
          envId: { type: sql.UniqueIdentifier, value: envId },
          team:  { type: sql.NVarChar, value: team },
        }
      );
      for (const admin of adminResult.recordset) {
        await notify({
          userId: admin.id,
          type: 'new_registration',
          title: 'New Access Request',
          body: `${fullName} (${team} team) has submitted a registration request.`,
          refId: newUser.id,
          io: req.app.get('io'),
        });
      }

      await auditLog({
        envId,
        actorId: newUser.id,
        actionType: 'user_registered',
        targetType: 'user',
        targetId: newUser.id,
        targetName: fullName,
        ipAddress: req.ip,
      });

      res.status(201).json({
        success: true,
        message: 'Registration submitted. You will be notified once your request is approved.',
        user: { id: newUser.id, fullName: newUser.full_name, team: newUser.team, status: newUser.status },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
    }
  }
);

// ── POST /api/auth/login ─────────────────────────────────────────────────
router.post('/login',
  validate([
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required.'),
    body('password').notEmpty().withMessage('Password is required.'),
    body('envCode').trim().notEmpty().withMessage('Environment code is required.'),
  ]),
  async (req, res) => {
    try {
      const { email, password, envCode } = req.body;

      const result = await query(
        `SELECT u.id, u.env_id, u.full_name, u.email, u.password_hash, u.team,
                u.role, u.status, u.avatar_initials, u.designation,
                e.firm_name, e.env_code
         FROM users u
         JOIN environments e ON e.id = u.env_id
         WHERE u.email = @email AND e.env_code = @envCode`,
        {
          email:   { type: sql.NVarChar, value: email },
          envCode: { type: sql.NVarChar, value: envCode.toUpperCase() },
        }
      );

      if (!result.recordset.length) {
        return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
      }

      const user = result.recordset[0];

      if (user.status === 'pending') {
        return res.status(403).json({ success: false, message: 'Your account is pending admin approval.' });
      }
      if (user.status === 'rejected') {
        return res.status(403).json({ success: false, message: 'Your access request was rejected. Contact your administrator.' });
      }
      if (user.status === 'deactivated') {
        return res.status(403).json({ success: false, message: 'Your account has been deactivated. Contact your administrator.' });
      }

      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Incorrect email or password.' });
      }

      const { accessToken, refreshToken } = generateTokens(user.id, user.env_id, user.role, user.team);

      // Store refresh token hash
      const tokenHash = await bcrypt.hash(refreshToken, 8);
      await query(
        `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
         VALUES (NEWID(), @userId, @hash, DATEADD(day, 30, GETUTCDATE()))`,
        {
          userId: { type: sql.UniqueIdentifier, value: user.id },
          hash:   { type: sql.NVarChar, value: tokenHash },
        }
      );

      // Update last login
      await query(
        `UPDATE users SET last_login_at = GETUTCDATE() WHERE id = @id`,
        { id: { type: sql.UniqueIdentifier, value: user.id } }
      );

      await auditLog({
        envId: user.env_id,
        actorId: user.id,
        actionType: 'user_login',
        targetType: 'user',
        targetId: user.id,
        targetName: user.full_name,
        ipAddress: req.ip,
      });

      res.json({
        success: true,
        accessToken,
        refreshToken,
        user: {
          id:           user.id,
          envId:        user.env_id,
          fullName:     user.full_name,
          email:        user.email,
          team:         user.team,
          role:         user.role,
          designation:  user.designation,
          initials:     user.avatar_initials,
          firmName:     user.firm_name,
          envCode:      user.env_code,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
    }
  }
);

// ── POST /api/auth/logout ────────────────────────────────────────────────
router.post('/logout', authenticate, async (req, res) => {
  try {
    // Invalidate all refresh tokens for this user
    await query(
      `DELETE FROM refresh_tokens WHERE user_id = @userId`,
      { userId: { type: sql.UniqueIdentifier, value: req.user.id } }
    );
    await auditLog({
      envId: req.user.env_id,
      actorId: req.user.id,
      actionType: 'user_logout',
      targetType: 'user',
      targetId: req.user.id,
      ipAddress: req.ip,
    });
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Logout failed.' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
