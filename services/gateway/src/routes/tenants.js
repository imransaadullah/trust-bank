// Proxies a tenant's own identity read back from the Ledger — admin-tier
// only, same posture as api-keys/usage/sandbox: a bank's technical admin
// reading their own name/status, not a banking-transaction route.
const express = require('express');
const { requireApiKey } = require('../middleware/auth');
const { resolveEffectiveTenant } = require('../middleware/resolveEffectiveTenant');
const { proxyRoute } = require('./proxyHelper');

const router = express.Router();
const adminOnly = [requireApiKey({ allowedTiers: ['admin'] }), resolveEffectiveTenant];

router.get('/:tenantId', adminOnly, proxyRoute('ledger', 'GET', () => '/v1/tenant'));

module.exports = router;
