// Verifies the bearer token, checks its tier is one this route accepts
// (admin-only for provisioning routes, sandbox/production for the actual
// proxied banking routes — see apiKeyService.js's tier comment), rejects
// a request whose :tenantId path param doesn't match the key's own
// tenant (same regression class SERVICE_CREDENTIAL_MODEL.md already
// closed on the other three services), and enforces the per-key rate
// limit before the request reaches a route handler at all.
const apiKeyService = require('../services/apiKeyService');
const rateLimitService = require('../services/rateLimitService');
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

module.exports = { requireApiKey };
