// Proxies to the Ledger — accounts and transfers. Request/response
// bodies are passed through unchanged; the Ledger does its own
// validation (see services/ledger/internal/httpapi), so this doesn't
// duplicate it.
const express = require('express');
const { requireApiKey } = require('../middleware/auth');
const { resolveEffectiveTenant } = require('../middleware/resolveEffectiveTenant');
const { proxyRoute } = require('./proxyHelper');

const router = express.Router();
const BANKING_TIERS = ['sandbox', 'production'];
const auth = [requireApiKey({ allowedTiers: BANKING_TIERS }), resolveEffectiveTenant];

router.post('/:tenantId/accounts', auth,
  proxyRoute('ledger', 'POST', () => '/v1/accounts', { statusCode: 201 }));

router.get('/:tenantId/accounts/:ledgerAccountId/balance', auth,
  proxyRoute('ledger', 'GET', (req) => `/v1/accounts/${encodeURIComponent(req.params.ledgerAccountId)}/balance`));

router.post('/:tenantId/transfers/p2p', auth,
  proxyRoute('ledger', 'POST', () => '/v1/transfers/p2p'));

router.post('/:tenantId/transfers/deposit/confirm', auth,
  proxyRoute('ledger', 'POST', () => '/v1/transfers/deposit/confirm'));

router.post('/:tenantId/transfers/withdrawal', auth,
  proxyRoute('ledger', 'POST', () => '/v1/transfers/withdrawal'));

module.exports = router;
