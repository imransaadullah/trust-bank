// Proxies to Checkout — merchant onboarding and checkout-session
// create/read/cancel. The hosted pay page (/pay/*) and inbound provider
// webhook (/v1/webhooks/*) are NOT proxied here — they're reached
// directly via Checkout's own public Caddy site block
// (deploy/Caddyfile.example), since an anonymous customer or a provider
// holds no tenant API key. See deploy/NETWORK_TOPOLOGY.md.
const express = require('express');
const { requireApiKey } = require('../middleware/auth');
const { resolveEffectiveTenant } = require('../middleware/resolveEffectiveTenant');
const { proxyRoute } = require('./proxyHelper');

const router = express.Router();
const BANKING_TIERS = ['sandbox', 'production'];
const auth = [requireApiKey({ allowedTiers: BANKING_TIERS }), resolveEffectiveTenant];

router.post('/:tenantId/merchants', auth,
  proxyRoute('checkout', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/merchants`, { statusCode: 201 }));

router.get('/:tenantId/merchants/:merchantId', auth,
  proxyRoute('checkout', 'GET', (req) => `/v1/tenants/${req.effectiveTenantId}/merchants/${req.params.merchantId}`));

router.get('/:tenantId/merchants', auth,
  proxyRoute('checkout', 'GET', (req) => `/v1/tenants/${req.effectiveTenantId}/merchants`));

router.post('/:tenantId/checkout-sessions', auth,
  proxyRoute('checkout', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/checkout-sessions`, { statusCode: 201 }));

router.get('/:tenantId/checkout-sessions/:sessionId', auth,
  proxyRoute('checkout', 'GET', (req) => `/v1/tenants/${req.effectiveTenantId}/checkout-sessions/${req.params.sessionId}`));

router.post('/:tenantId/checkout-sessions/:sessionId/cancel', auth,
  proxyRoute('checkout', 'POST', (req) => `/v1/tenants/${req.effectiveTenantId}/checkout-sessions/${req.params.sessionId}/cancel`));

module.exports = router;
