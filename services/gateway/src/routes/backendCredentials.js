// Admin-tier only — stores this tenant's Ledger/Payments/Compliance/
// Cards/Checkout credential (issued the normal way, via each backend's
// own bootstrap-key/bootstrapKey.js, then handed to the gateway to hold
// on the tenant's behalf). deploy/provision-tenant.sh calls this once
// per tenant per backend; see TenantBackendCredential's schema comment
// for why the gateway needs its own copy rather than reusing the product
// backend's. `scope` defaults to 'operate' (every proxied banking call);
// pass 'admin' for a second, separate credential a self-service feature
// needs its issuing service's own admin scope for (e.g. compliance
// policy publish/read) — see compliancePolicies.js.
const express = require('express');
const tenantBackendCredentialService = require('../services/tenantBackendCredentialService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();
const adminOnly = requireApiKey({ allowedTiers: ['admin'] });

router.post('/:tenantId/backend-credentials', adminOnly, async (req, res, next) => {
  try {
    const { service, token, scope = 'operate' } = req.body;
    if (!tenantBackendCredentialService.VALID_SERVICES.includes(service) || !token) {
      return res.status(400).json({ success: false, error: "service must be 'ledger', 'payments', 'compliance', 'cards', or 'checkout', and token is required" });
    }
    if (!tenantBackendCredentialService.VALID_SCOPES.includes(scope)) {
      return res.status(400).json({ success: false, error: "scope must be 'operate' or 'admin'" });
    }
    await tenantBackendCredentialService.store({ tenantId: req.params.tenantId, service, token, scope });
    res.status(201).json({ success: true, data: { tenantId: req.params.tenantId, service, scope, status: 'stored' } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
