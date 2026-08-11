const logger = require('../utils/logger');
const { TrustPayError } = require('../utils/errors');

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof TrustPayError) {
    logger.warn(`[${err.code}] ${err.message}`, { path: req.path });
    return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code });
  }

  if (err.status || err.ledgerErrorBody || err.paymentsErrorBody) {
    const status = err.status || 502;
    const body = err.ledgerErrorBody || err.paymentsErrorBody;
    logger.warn(`Upstream error ${status}: ${err.message}`, { path: req.path, body });
    return res.status(status >= 400 && status < 600 ? status : 502).json({
      success: false, error: body?.error || err.message,
    });
  }

  logger.error(err.message, { stack: err.stack, path: req.path });
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

module.exports = errorHandler;
