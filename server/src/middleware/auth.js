const jwt = require('jsonwebtoken');
const { query, sql } = require('../db');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch fresh user from DB (ensures deactivated users are blocked)
    const result = await query(
      `SELECT u.id, u.env_id, u.full_name, u.email, u.team, u.role,
              u.status, u.avatar_initials, u.designation,
              e.firm_name, e.env_code
       FROM users u
       JOIN environments e ON e.id = u.env_id
       WHERE u.id = @id`,
      { id: { type: sql.UniqueIdentifier, value: decoded.userId } }
    );

    if (!result.recordset.length) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    const user = result.recordset[0];

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: user.status === 'deactivated'
          ? 'Your account has been deactivated. Contact your administrator.'
          : 'Your account is pending approval.',
      });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
};

/**
 * Role guard middleware factory.
 * Usage: requireRole('admin', 'platform_admin')
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthenticated.' });
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
  }
  next();
};

/**
 * Team guard middleware factory.
 * Usage: requireTeam('CA')
 */
const requireTeam = (...teams) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthenticated.' });
  if (!teams.includes(req.user.team) && req.user.role !== 'platform_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'Access denied. Wrong team.' });
  }
  next();
};

module.exports = { authenticate, requireRole, requireTeam };
