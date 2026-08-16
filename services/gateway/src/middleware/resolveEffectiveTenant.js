// Runs after requireApiKey. A bank always calls
// /v1/tenants/{realTenantId}/... regardless of key tier — this resolves
// which tenant a request actually gets proxied to: the real tenant for
// production/admin keys, the sandbox twin for sandbox-tier keys. Route
// handlers (proxyHelper.js, and identity.js/compliance.js's own path
// builders, which embed the tenant id in the backend URL path) use
// req.effectiveTenantId, never req.params.tenantId directly.
const sandboxTenantService = require('../services/sandboxTenantService');

async function resolveEffectiveTenant(req, res, next) {
  try {
    req.effectiveTenantId = req.apiKey.tier === 'sandbox'
      ? await sandboxTenantService.resolve(req.params.tenantId)
      : req.params.tenantId;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { resolveEffectiveTenant };
