// Admin-tier only — registers a tenant's synthetic sandbox twin (its own
// Ledger tenant, its own credentials on all three backends). Called by
// deploy/provision-tenant.sh's provision_sandbox_twin once per tenant,
// after that twin has actually been created and provisioned the same way
// any tenant is — not by a bank's own integration. See SandboxTenant's
// schema comment and src/middleware/resolveEffectiveTenant.js.
const express = require('express');
const sandboxTenantService = require('../services/sandboxTenantService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();
const adminOnly = requireApiKey({ allowedTiers: ['admin'] });

router.post('/:tenantId/sandbox', adminOnly, async (req, res, next) => {
  try {
    const { sandboxTenantId } = req.body;
    if (!sandboxTenantId) {
      return res.status(400).json({ success: false, error: 'sandboxTenantId is required' });
    }
    await sandboxTenantService.register({ realTenantId: req.params.tenantId, sandboxTenantId });
    res.status(201).json({ success: true, data: { tenantId: req.params.tenantId, sandboxTenantId, status: 'registered' } });
  } catch (err) {
    next(err);
  }
});

router.get('/:tenantId/sandbox', adminOnly, async (req, res, next) => {
  try {
    const row = await sandboxTenantService.get(req.params.tenantId);
    if (!row) {
      return res.status(404).json({ success: false, error: 'No sandbox tenant provisioned yet', code: 'SANDBOX_NOT_PROVISIONED' });
    }
    res.json({ success: true, data: { tenantId: row.realTenantId, sandboxTenantId: row.sandboxTenantId } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
