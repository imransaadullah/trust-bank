const { randomUUID, createHmac, timingSafeEqual } = require('crypto');
const { CardIssuingProvider } = require('./cardIssuingProvider');
const logger = require('../utils/logger');

// The only provider until a real card-issuing-as-a-service relationship
// exists. providerRef and last4 are both obviously synthetic — a UUID
// prefixed noop_card_, and a last4 drawn from a fixed, clearly-fake
// range — deliberately not realistic-looking, so nothing here could ever
// be mistaken for real card data even by accident.
//
// The webhook shape (event/cardProviderRef/amountKobo, an
// x-noop-signature header) is invented by this file, not a real
// provider's spec — there's nothing to match yet. A real provider's own
// implementation defines its own shape entirely; nothing outside a
// provider file (this contract, cardWebhooks.js) needs to know it.
class NoopCardIssuingProvider extends CardIssuingProvider {
  constructor(credentials = {}) {
    super('noop');
    this.webhookSecret = credentials.webhookSecret || 'noop-default-webhook-secret';
  }

  async issueCard(input) {
    const card = {
      providerRef: `noop_card_${randomUUID()}`,
      last4: '0000',
      expiryMonth: 1,
      expiryYear: new Date().getUTCFullYear() + 3,
    };
    logger.info(`[NoopCardIssuingProvider] would issue card: ${JSON.stringify({ ...input, ...card })}`);
    return card;
  }

  async freezeCard(providerRef) {
    logger.info(`[NoopCardIssuingProvider] would freeze card: ${providerRef}`);
    return { success: true };
  }

  async unfreezeCard(providerRef) {
    logger.info(`[NoopCardIssuingProvider] would unfreeze card: ${providerRef}`);
    return { success: true };
  }

  async closeCard(providerRef) {
    logger.info(`[NoopCardIssuingProvider] would close card: ${providerRef}`);
    return { success: true };
  }

  verifyWebhookSignature(rawBody, headers) {
    const signature = headers['x-noop-signature'];
    if (!signature) return false;
    try {
      const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch (error) {
      logger.error(`[NoopCardIssuingProvider] webhook verification error: ${error.message}`);
      return false;
    }
  }

  parseWebhookEvent(eventBody) {
    return {
      type: eventBody.event,
      cardProviderRef: eventBody.cardProviderRef,
      amountKobo: eventBody.amountKobo,
      reference: eventBody.reference,
      raw: eventBody,
    };
  }

  formatAuthorizationResponse(decision) {
    return { approved: decision.approved, declineReason: decision.reason || null };
  }
}

module.exports = { NoopCardIssuingProvider };
