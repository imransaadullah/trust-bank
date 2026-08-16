const logger = require('../utils/logger');
const { GatewayError, RateLimitExceededError } = require('../utils/errors');

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof RateLimitExceededError) {
    res.set('Retry-After', String(err.retryAfterSeconds));
    logger.warn(`[${err.code}] ${err.message}`, { path: req.path });
    return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code });
  }

  if (err instanceof GatewayError) {
    logger.warn(`[${err.code}] ${err.message}`, { path: req.path });
    return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code });
  }

  // A real, meaningful rejection from a backend (Ledger/Payments/
  // Compliance) — e.g. "No provider configured for tenant X" — reaching
  // the gateway as a plain AxiosError. Caught live during this feature's
  // own verification: without this, every backend 4xx/5xx collapsed into
  // an uninformative "Internal server error" here, hiding exactly the
  // detail a bank's engineers would need while integrating. Propagate
  // the backend's own status and message instead of masking it.
  if (err.isAxiosError && err.response) {
    const body = err.response.data;
    logger.warn(`Backend responded ${err.response.status}: ${JSON.stringify(body)}`, { path: req.path });
    return res.status(err.response.status).json({
      success: false,
      error: (body && (body.error || body.message)) || err.message,
      code: (body && body.code) || 'BACKEND_ERROR',
    });
  }

  logger.error(err.message, { stack: err.stack, path: req.path });
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

module.exports = errorHandler;
