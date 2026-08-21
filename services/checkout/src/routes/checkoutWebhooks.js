// Mounted with express.raw() in app.js — signature verification needs
// the exact raw bytes the provider signed, not a re-serialized
// JSON.parse() of it. Same reasoning as services/cards' own
// cardWebhooks.js. Public, unauthenticated (a provider holds no tenant
// API key) — authenticated entirely by its own signature.
const express = require('express');
const checkoutWebhookService = require('../services/checkoutWebhookService');

const router = express.Router();

router.post('/:tenantSlug/:provider', async (req, res, next) => {
  try {
    const result = await checkoutWebhookService.handleProviderWebhook(
      req.params.tenantSlug, req.params.provider, req.body, req.headers,
    );
    res.json({ received: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
