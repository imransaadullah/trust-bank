// Placeholder auth — same shape and same caveat as the Ledger's
// LEDGER_SHARED_SECRET (see services/ledger/internal/httpapi/middleware.go
// and AUTHCORE_SCOPED_CLIENT_KEY_SPEC.md). Fine for now: the only real
// callers are TrustPay's backend and this service's own webhook routes
// (which authenticate differently — via the provider's own signature).
const config = require('../config');

function requireSharedSecret(req, res, next) {
  const auth = req.headers.authorization || '';
  const expected = `Bearer ${config.sharedSecret}`;
  if (auth !== expected) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireSharedSecret };
