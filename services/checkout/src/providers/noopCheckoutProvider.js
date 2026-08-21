const { randomUUID, createHmac, timingSafeEqual } = require('crypto');
const { CheckoutProvider } = require('./checkoutProvider');
const logger = require('../utils/logger');

// The only provider live-verified end to end this slice — no real
// commercial relationship needed to exercise the full session/webhook/
// settlement lifecycle. authorizationUrl points at this service's own
// GET /pay/:sessionId/simulate page (callbackUrl is always
// `${publicBaseUrl}/pay/:sessionId`, so appending /simulate lands
// there) — a real "Pay now" click, a real page render, a real signed
// webhook POST back into this service, exercising the *same*
// checkoutWebhookService.handleProviderWebhook() the real inbound
// route uses, not a shortcut around it.
//
// The webhook shape (event/reference/amount/paidAt, an
// x-noop-signature header) is invented by this file, not a real
// provider's spec — there's nothing to match yet. Same posture
// NoopCardIssuingProvider already takes for its own webhook shape.
class NoopCheckoutProvider extends CheckoutProvider {
  constructor(credentials = {}) {
    super('noop');
    this.webhookSecret = credentials.webhookSecret || 'noop-default-webhook-secret';
  }

  async initializeTransaction(input) {
    const providerRef = `noop_chk_${randomUUID()}`;
    logger.info(`[NoopCheckoutProvider] would initialize transaction: ${JSON.stringify({ ...input, providerRef })}`);
    return { authorizationUrl: `${input.callbackUrl}/simulate`, providerRef };
  }

  async verifyTransaction(_reference) {
    // Nothing external to check — the hosted page never calls this for
    // a noop-provider session (guarded by provider.name !== 'noop' in
    // checkoutSessionService.getAndSync). Present for contract
    // completeness only.
    return { status: 'abandoned', amountKobo: 0, paidAt: null, raw: {} };
  }

  verifyWebhookSignature(rawBody, headers) {
    const signature = headers['x-noop-signature'];
    if (!signature) return false;
    try {
      const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch (error) {
      logger.error(`[NoopCheckoutProvider] webhook verification error: ${error.message}`);
      return false;
    }
  }

  parseWebhookEvent(eventBody) {
    if (eventBody.event !== 'charge.success') return { type: 'unknown', raw: eventBody };
    return {
      type: 'charge.success',
      reference: eventBody.reference,
      amountKobo: eventBody.amount,
      paidAt: eventBody.paidAt || new Date().toISOString(),
      raw: eventBody,
    };
  }
}

module.exports = { NoopCheckoutProvider };
