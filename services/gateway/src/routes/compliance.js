// Proxies to Compliance — the two decision checks a bank's own
// integration would call before a transaction (see
// COMPLIANCE_DESIGN_AND_BACKLOG.md's decision-contract shape).
const express = require('express');
const { requireApiKey } = require('../middleware/auth');
const { resolveEffectiveTenant } = require('../middleware/resolveEffectiveTenant');
const { proxyRoute } = require('./proxyHelper');

const router = express.Router();
const BANKING_TIERS = ['sandbox', 'production'];
const auth = [requireApiKey({ allowedTiers: BANKING_TIERS }), resolveEffectiveTenant];

router.post('/:tenantId/compliance/kyc-tier-check', auth,
  proxyRoute('compliance', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/compliance/kyc-tier-check`));

router.post('/:tenantId/compliance/device-check', auth,
  proxyRoute('compliance', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/compliance/device-check`));

module.exports = router;
