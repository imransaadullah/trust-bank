// Verifies the bearer token, checks its tier is one this route accepts
// (admin-only for provisioning routes, sandbox/production for the actual
// proxied banking routes — see apiKeyService.js's tier comment), rejects
// a request whose :tenantId path param doesn't match the key's own
// tenant (same regression class SERVICE_CREDENTIAL_MODEL.md already
// closed on the other three services), and enforces the per-key rate
// limit before the request reaches a route handler at all.
const apiKeyService = require('../services/apiKeyService');
const rateLimitService = require('../services/rateLimitService');
const gatewaySessionService = require('../services/gatewaySessionService');
const { RateLimitExceededError } = require('../utils/errors');

function requireApiKey({ allowedTiers }) {
  return async (req, res, next) => {
    try {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const token = auth.slice('Bearer '.length);

      const apiKey = await apiKeyService.verify(token);
      if (!apiKey) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      if (!allowedTiers.includes(apiKey.tier)) {
        return res.status(403).json({ success: false, error: `This route requires a key with tier: ${allowedTiers.join(' or ')}` });
      }
      if (req.params.tenantId && req.params.tenantId !== apiKey.tenantId) {
        return res.status(403).json({ success: false, error: 'Key is not authorized for this tenant' });
      }

      const count = await rateLimitService.incrementAndGetCount(apiKey.id);
      res.set('X-RateLimit-Limit', String(apiKey.rateLimitPerMinute));
      res.set('X-RateLimit-Remaining', String(Math.max(0, apiKey.rateLimitPerMinute - count)));
      if (count > apiKey.rateLimitPerMinute) {
        throw new RateLimitExceededError(rateLimitService.secondsUntilWindowReset());
      }

      req.apiKey = apiKey;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Accepts either a gw_live_ admin-tier API key (the original, sole login
// method) or a gws_live_ GatewaySession token (issued by staffLogin.js
// after verifying a pasted Identity staff session for an ops_admin). A
// GatewaySession has no tier of its own — it's always equivalent to
// admin-tier access for the tenant it belongs to — so it's normalized
// into the same req.apiKey shape requireApiKey already produces
// (tier: 'admin'), meaning resolveEffectiveTenant and every route handler
// downstream needs zero changes to accept either credential
// interchangeably. Used only on the admin-console's own self-service
// routes (api-keys, usage, sandbox, tenants, compliance policies) —
// never on the banking/decisioning proxy routes, and never on
// backend-credentials, a bootstrap/provisioning action that stays
// API-key-only.
function requireAdminAccess() {
  return async (req, res, next) => {
    try {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const token = auth.slice('Bearer '.length);

      if (gatewaySessionService.isSessionToken(token)) {
        const session = await gatewaySessionService.verify(token);
        if (req.params.tenantId && req.params.tenantId !== session.tenantId) {
          return res.status(403).json({ success: false, error: 'Session is not authorized for this tenant' });
        }
        // No per-session rate limiting today — a human-browsed dashboard
        // session is a materially different risk profile than a machine
        // API key; named here as a scope trim, not an oversight.
        req.apiKey = { id: session.id, tier: 'admin', tenantId: session.tenantId };
        req.gatewaySession = session;
        return next();
      }

      const apiKey = await apiKeyService.verify(token);
      if (!apiKey) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      if (apiKey.tier !== 'admin') {
        return res.status(403).json({ success: false, error: 'This route requires a key with tier: admin' });
      }
      if (req.params.tenantId && req.params.tenantId !== apiKey.tenantId) {
        return res.status(403).json({ success: false, error: 'Key is not authorized for this tenant' });
      }

      const count = await rateLimitService.incrementAndGetCount(apiKey.id);
      res.set('X-RateLimit-Limit', String(apiKey.rateLimitPerMinute));
      res.set('X-RateLimit-Remaining', String(Math.max(0, apiKey.rateLimitPerMinute - count)));
      if (count > apiKey.rateLimitPerMinute) {
        throw new RateLimitExceededError(rateLimitService.secondsUntilWindowReset());
      }

      req.apiKey = apiKey;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireApiKey, requireAdminAccess };
