// Replaces the single static COMPLIANCE_SHARED_SECRET — see
// SERVICE_CREDENTIAL_MODEL.md (repo root) and credentialService.js.
// Verifies the bearer token, checks it carries at least the route's
// required scope, and rejects a request whose :tenantId path param
// doesn't match the credential's own tenant.
const credentialService = require('../services/credentialService');

function requireApiKey(minScope) {
  return async (req, res, next) => {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const token = auth.slice('Bearer '.length);

    const credential = await credentialService.verify(token);
    if (!credential) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (!scopeSatisfies(credential.scope, minScope)) {
      return res.status(403).json({ success: false, error: 'Insufficient scope' });
    }
    if (req.params.tenantId && req.params.tenantId !== credential.tenantId) {
      return res.status(403).json({ success: false, error: 'Token is not authorized for this tenant' });
    }

    req.apiCredential = credential;
    next();
  };
}

function scopeSatisfies(have, need) {
  if (have === need) return true;
  return have === 'admin' && need === 'operate';
}

module.exports = { requireApiKey };
