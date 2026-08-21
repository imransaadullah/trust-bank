const { ProviderNotImplementedError } = require('../utils/errors');

/**
 * The contract a real hosted-checkout provider (Paystack, Flutterwave,
 * Squad) would implement. Mirrors services/cards' CardIssuingProvider
 * pattern: one abstract base, swappable concrete providers, nothing
 * outside a provider file knows which one a tenant is on.
 *
 * @typedef {Object} InitializedTransaction
 * @property {string} authorizationUrl the provider's own hosted pay page —
 *   what the hosted page's "Pay now" link points to
 * @property {string} providerRef
 *
 * @typedef {Object} VerifiedTransaction
 * @property {'success'|'failed'|'abandoned'} status
 * @property {number} amountKobo
 * @property {string|null} paidAt
 * @property {Object} raw
 *
 * @typedef {Object} WebhookEvent
 * @property {'charge.success'|'unknown'} type
 * @property {string} [reference] this service's own CheckoutSession.reference
 * @property {number} [amountKobo]
 * @property {string|null} [paidAt]
 * @property {Object} raw
 */
class CheckoutProvider {
  constructor(name) {
    this.name = name;
  }

  /** @param {{reference: string, amountKobo: number, email: string, callbackUrl: string, metadata?: Object}} _input
   * @returns {Promise<InitializedTransaction>} */
  async initializeTransaction(_input) {
    throw new ProviderNotImplementedError(this.name, 'initializeTransaction');
  }

  /** The authoritative status check — used to cover the webhook-vs-redirect
   * race when a customer lands back on the hosted page before the webhook
   * arrives. @returns {Promise<VerifiedTransaction>} */
  async verifyTransaction(_reference) {
    throw new ProviderNotImplementedError(this.name, 'verifyTransaction');
  }

  /**
   * Verify a webhook's signature over the raw request body. Takes the
   * full headers object, not one guessed header name — same reasoning
   * as CardIssuingProvider's own comment. Must not throw — return false
   * on failure.
   */
  verifyWebhookSignature(_rawBody, _headers) {
    throw new ProviderNotImplementedError(this.name, 'verifyWebhookSignature');
  }

  /** Normalize a provider's webhook payload. @returns {WebhookEvent} */
  parseWebhookEvent(_eventBody) {
    throw new ProviderNotImplementedError(this.name, 'parseWebhookEvent');
  }
}

module.exports = { CheckoutProvider };
