// Proxies to Cards — issuance, lifecycle, and the manual/ops
// authorize/settle entry points (the automatic path is Cards' own
// webhook route, not proxied here — a real provider calls Cards
// directly, never through the Gateway). Request/response bodies pass
// through unchanged; Cards does its own validation.
const express = require('express');
const { requireApiKey } = require('../middleware/auth');
const { resolveEffectiveTenant } = require('../middleware/resolveEffectiveTenant');
const { proxyRoute } = require('./proxyHelper');

const router = express.Router();
const BANKING_TIERS = ['sandbox', 'production'];
const auth = [requireApiKey({ allowedTiers: BANKING_TIERS }), resolveEffectiveTenant];

router.post('/:tenantId/cards', auth,
  proxyRoute('cards', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/cards`, { statusCode: 201 }));

router.get('/:tenantId/customers/:externalCustomerId/cards', auth,
  proxyRoute('cards', 'GET', (req) => `/v1/tenants/${req.effectiveTenantId}/customers/${encodeURIComponent(req.params.externalCustomerId)}/cards`));

router.post('/:tenantId/cards/:cardId/freeze', auth,
  proxyRoute('cards', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/cards/${req.params.cardId}/freeze`));

router.post('/:tenantId/cards/:cardId/unfreeze', auth,
  proxyRoute('cards', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/cards/${req.params.cardId}/unfreeze`));

router.post('/:tenantId/cards/:cardId/close', auth,
  proxyRoute('cards', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/cards/${req.params.cardId}/close`));

router.post('/:tenantId/cards/:cardId/authorize', auth,
  proxyRoute('cards', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/cards/${req.params.cardId}/authorize`));

router.post('/:tenantId/cards/:cardId/settle', auth,
  proxyRoute('cards', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/cards/${req.params.cardId}/settle`));

module.exports = router;
