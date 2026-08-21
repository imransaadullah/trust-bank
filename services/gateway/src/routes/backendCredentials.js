// Admin-tier only — stores this tenant's Ledger/Payments/Compliance/
// Cards/Checkout operate credential (issued the normal way, via each
// backend's own
// bootstrap-key/bootstrapKey.js, then handed to the gateway to hold on
// the tenant's behalf). deploy/provision-tenant.sh calls this once per
// tenant per backend; see TenantBackendCredential's schema comment for
// why the gateway needs its own copy rather than reusing the product
// backend's.
const express = require('express');
const tenantBackendCredentialService = require('../services/tenantBackendCredentialService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();
const adminOnly = requireApiKey({ allowedTiers: ['admin'] });

router.post('/:tenantId/backend-credentials', adminOnly, async (req, res, next) => {
  try {
    const { service, token } = req.body;
    if (!tenantBackendCredentialService.VALID_SERVICES.includes(service) || !token) {
      return res.status(400).json({ success: false, error: "service must be 'ledger', 'payments', 'compliance', 'cards', or 'checkout', and token is required" });
    }
    await tenantBackendCredentialService.store({ tenantId: req.params.tenantId, service, token });
    res.status(201).json({ success: true, data: { tenantId: req.params.tenantId, service, status: 'stored' } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
