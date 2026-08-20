// Mounted with express.raw() in app.js — signature verification needs the
// exact raw bytes the provider signed, not a re-serialized JSON.parse()
// of it. Same reasoning as services/payments' own webhooks.js.
//
// This is the automatic path a real provider will eventually drive in
// production; slice 1's direct /authorize and /settle routes
// (routes/cards.js) stay as the manual/ops equivalent and as how this
// route itself is tested today, against the noop provider.
const express = require('express');
const tenantCardProviderConfigService = require('../services/tenantCardProviderConfigService');
const cardService = require('../services/cardService');
const { InvalidProviderError, WebhookVerificationError } = require('../utils/errors');
const logger = require('../utils/logger');

const router = express.Router();

router.post('/:tenantSlug/:provider', async (req, res, next) => {
  try {
    const { tenantId, provider } = await tenantCardProviderConfigService.getProviderForTenantSlug(req.params.tenantSlug);
    if (provider.name !== req.params.provider) {
      throw new InvalidProviderError(req.params.provider);
    }
    if (!provider.verifyWebhookSignature(req.body, req.headers)) {
      throw new WebhookVerificationError();
    }

    const eventBody = JSON.parse(req.body.toString('utf8'));
    const event = provider.parseWebhookEvent(eventBody);
    const card = await cardService.getCardByProviderRef(tenantId, event.cardProviderRef);

    if (event.type === 'authorization') {
      // Synchronous — a real processor is waiting on this response to
      // decide whether the cardholder's transaction goes through.
      const decision = await cardService.authorize({ tenantId, cardId: card.id, amountKobo: event.amountKobo });
      return res.json(provider.formatAuthorizationResponse(decision));
    }

    if (event.type === 'settlement') {
      // Async — clearing/settlement webhooks don't need a
      // provider-specific response body, just acknowledgement.
      await cardService.settle({
        tenantId, cardId: card.id, amountKobo: event.amountKobo,
        reference: event.reference, idempotencyKey: event.reference,
        description: `${provider.name} settlement webhook`,
      });
      return res.json({ received: true });
    }

    logger.warn(`[CardWebhooks] unhandled event type: ${event.type}`, { tenantSlug: req.params.tenantSlug });
    return res.json({ received: true, handled: false });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
