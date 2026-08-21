// Public, unauthenticated — reachable directly via its own Caddy site
// block (deploy/Caddyfile.example), never through the Gateway, since an
// anonymous customer holds no tenant API key. See
// deploy/NETWORK_TOPOLOGY.md for the narrow exception this represents.
const express = require('express');
const { createHmac } = require('crypto');
const checkoutSessionService = require('../services/checkoutSessionService');
const merchantService = require('../services/merchantService');
const tenantCheckoutProviderConfigService = require('../services/tenantCheckoutProviderConfigService');
const checkoutWebhookService = require('../services/checkoutWebhookService');
const { renderHostedPage, renderSimulatePage } = require('../views/hostedPage');

const router = express.Router();

router.get('/:sessionId', async (req, res, next) => {
  try {
    const session = await checkoutSessionService.getAndSyncPublic(req.params.sessionId);
    const merchant = await merchantService.requireExists({ tenantId: session.tenantId, merchantId: session.merchantId });
    res.type('html').send(renderHostedPage({
      merchantName: merchant.name,
      amountKobo: session.amountKobo,
      currency: session.currency,
      status: session.status,
      authorizationUrl: session.authorizationUrl,
      reference: session.reference,
    }));
  } catch (err) {
    next(err);
  }
});

// Noop-only — a real provider's authorizationUrl points straight at its
// own hosted page, so this is unreachable in practice for a
// 'paystack'-provider session.
router.get('/:sessionId/simulate', async (req, res, next) => {
  try {
    const session = await checkoutSessionService.getPublic(req.params.sessionId);
    const merchant = await merchantService.requireExists({ tenantId: session.tenantId, merchantId: session.merchantId });
    res.type('html').send(renderSimulatePage({
      merchantName: merchant.name, amountKobo: session.amountKobo, currency: session.currency, sessionId: session.id,
    }));
  } catch (err) {
    next(err);
  }
});

// Constructs and signs a synthetic 'charge.success' webhook exactly as
// a real provider would, then routes it through the *same*
// checkoutWebhookService.handleProviderWebhook() the real inbound
// POST /v1/webhooks/:tenantSlug/:provider route uses — not a shortcut
// around the real completion path.
router.post('/:sessionId/simulate', express.urlencoded({ extended: false }), async (req, res, next) => {
  try {
    const session = await checkoutSessionService.getPublic(req.params.sessionId);
    const { tenantId, provider } = await tenantCheckoutProviderConfigService.getProviderForTenant(session.tenantId);
    if (provider.name !== 'noop') {
      return res.status(400).json({ success: false, error: 'Simulation is only available for the noop provider' });
    }
    const configRow = await tenantCheckoutProviderConfigService.getConfigByTenantId(tenantId);

    const eventBody = {
      event: 'charge.success',
      reference: session.reference,
      amount: session.amountKobo,
      paidAt: new Date().toISOString(),
    };
    const rawBody = Buffer.from(JSON.stringify(eventBody));
    const signature = createHmac('sha256', provider.webhookSecret).update(rawBody).digest('hex');

    await checkoutWebhookService.handleProviderWebhook(configRow.tenantSlug, 'noop', rawBody, { 'x-noop-signature': signature });

    res.redirect(303, `/pay/${session.id}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
