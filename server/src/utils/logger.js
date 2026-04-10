const winston = require('winston');
const path = require('path');

const IS_VERCEL = process.env.VERCEL === '1';
const logDir = path.join(__dirname, '../../logs');

const transports = [];

// File transports only work in local dev (Vercel has read-only filesystem)
if (!IS_VERCEL) {
  transports.push(
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(logDir, 'combined.log') }),
  );
}

// Always add console in dev, and on Vercel (where it goes to Vercel's log viewer)
if (process.env.NODE_ENV !== 'production' || IS_VERCEL) {
  transports.push(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }));
}

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'cads-bridge' },
  transports,
});

module.exports = logger;

