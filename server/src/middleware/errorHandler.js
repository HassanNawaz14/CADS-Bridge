const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.url,
    method: req.method,
  });

  // Never expose stack traces to end users
  const statusCode = err.statusCode || err.status || 500;
  const message = statusCode === 500
    ? 'An internal error occurred. Please try again later.'
    : err.message;

  res.status(statusCode).json({ success: false, message });
};

const notFound = (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found.` });
};

module.exports = { errorHandler, notFound };
