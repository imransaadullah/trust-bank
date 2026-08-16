// Every proxied route is the same shape: call a backend as the calling
// tenant, wrap the result in this platform's standard envelope. Factored
// out once real repetition showed up (5+ near-identical route bodies
// across accounts/identity/compliance), not speculatively.
const backendProxy = require('../services/backendProxy');

function proxyRoute(service, method, pathBuilder, { statusCode = 200 } = {}) {
  return async (req, res, next) => {
    try {
      const data = await backendProxy.call(service, {
        method, path: pathBuilder(req), tenantId: req.effectiveTenantId, data: req.body,
      });
      res.status(statusCode).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { proxyRoute };
