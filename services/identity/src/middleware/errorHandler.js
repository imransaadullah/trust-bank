const logger = require('../utils/logger');
const { IdentityError } = require('../utils/errors');

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof IdentityError) {
    logger.warn(`[${err.code}] ${err.message}`, { path: req.path });
    return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code });
  }

  logger.error(err.message, { stack: err.stack, path: req.path });
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

module.exports = errorHandler;
