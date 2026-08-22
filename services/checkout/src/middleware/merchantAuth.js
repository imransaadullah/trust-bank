// Lets a route serve both the tenant (browsing all their merchants'
// data through their own operate-scope ApiCredential — the existing
// requireApiKey) and an individual merchant (locked to only their own
// data through a MerchantSession) without duplicating route logic. A
// mch_live_-prefixed bearer token is a MerchantSession; anything else is
// checked against the tenant's own ApiCredential exactly as requireApiKey
// already does.
const credentialService = require('../services/credentialService');
const merchantSessionService = require('./../services/merchantSessionService');

function resolveMerchantScope() {
  return async (req, res, next) => {
    try {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const token = auth.slice('Bearer '.length);

      if (merchantSessionService.isSessionToken(token)) {
        const session = await merchantSessionService.verify(token);
        if (req.params.tenantId && req.params.tenantId !== session.tenantId) {
          return res.status(403).json({ success: false, error: 'Session is not authorized for this tenant' });
        }
        req.merchantSession = session;
        req.scopedMerchantId = session.merchantId;
        return next();
      }

      const credential = await credentialService.verify(token);
      if (!credential) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      if (credential.scope !== 'operate' && credential.scope !== 'admin') {
        return res.status(403).json({ success: false, error: 'Insufficient scope' });
      }
      if (req.params.tenantId && req.params.tenantId !== credential.tenantId) {
        return res.status(403).json({ success: false, error: 'Token is not authorized for this tenant' });
      }

      req.apiCredential = credential;
      // A tenant credential can optionally filter to one merchant via
      // ?merchantId=, or see every merchant's data when omitted —
      // unlike a MerchantSession, which is always locked to its own.
      req.scopedMerchantId = req.query.merchantId || undefined;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { resolveMerchantScope };
