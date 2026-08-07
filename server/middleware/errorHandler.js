'use strict';

const { HttpError } = require('../lib/errors');
const config = require('../config');

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // SQLite constraint violations map cleanly onto 409.
  if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
    return res.status(409).json({ error: 'That value is already taken or violates a data rule.' });
  }

  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  return res.status(500).json({
    error: 'Something went wrong on our side.',
    ...(config.env === 'development' ? { stack: String(err && err.stack) } : {}),
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: `No API route matches ${req.method} ${req.originalUrl}` });
}

module.exports = { errorHandler, notFoundHandler };
