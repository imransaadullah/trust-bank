// Proxies to Payments — identity verification and payouts.
const express = require('express');
const { requireApiKey } = require('../middleware/auth');
const { resolveEffectiveTenant } = require('../middleware/resolveEffectiveTenant');
const { proxyRoute } = require('./proxyHelper');

const router = express.Router();
const BANKING_TIERS = ['sandbox', 'production'];
const auth = [requireApiKey({ allowedTiers: BANKING_TIERS }), resolveEffectiveTenant];

router.post('/:tenantId/identity/verify', auth,
  proxyRoute('payments', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/identity/verify`));

router.post('/:tenantId/payouts', auth,
  proxyRoute('payments', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/payouts`));

module.exports = router;
