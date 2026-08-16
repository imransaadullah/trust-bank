// Proxies to Payments — identity verification and payouts.
const express = require('express');
const { requireApiKey } = require('../middleware/auth');
const { proxyRoute } = require('./proxyHelper');

const router = express.Router();
const BANKING_TIERS = ['sandbox', 'production'];
const auth = requireApiKey({ allowedTiers: BANKING_TIERS });

router.post('/:tenantId/identity/verify', auth,
  proxyRoute('payments', 'POST', (req) => `/v1/tenants/${req.params.tenantId}/identity/verify`));

router.post('/:tenantId/payouts', auth,
  proxyRoute('payments', 'POST', (req) => `/v1/tenants/${req.params.tenantId}/payouts`));

module.exports = router;
