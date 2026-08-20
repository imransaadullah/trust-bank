const { ProviderNotImplementedError } = require('../utils/errors');

/**
 * The contract a real card-issuing-as-a-service provider (Marqeta,
 * Galileo, or a Nigeria-specific program manager) would implement.
 * Mirrors services/payments' PaymentsProvider pattern: one abstract
 * base, swappable concrete providers, nothing outside a provider file
 * knows which one a tenant is on.
 *
 * This is the ONLY place a real PAN would ever exist in this platform —
 * and even here, only inside a real provider's own implementation
 * (calling out to the provider's API), never stored or logged by this
 * service. noopCardIssuingProvider.js, the only implementation that
 * exists today, never sees or returns anything resembling real card
 * data — see its own comment.
 *
 * @typedef {Object} IssuedCard
 * @property {string} providerRef opaque tokenized reference — never a PAN
 * @property {string} last4
 * @property {number} expiryMonth
 * @property {number} expiryYear
 *
 * @typedef {Object} ProviderResult
 * @property {boolean} success
 */
class CardIssuingProvider {
  constructor(name) {
    this.name = name;
  }

  /** @returns {Promise<IssuedCard>} */
  async issueCard(_input) {
    throw new ProviderNotImplementedError(this.name, 'issueCard');
  }

  /** @returns {Promise<ProviderResult>} */
  async freezeCard(_providerRef) {
    throw new ProviderNotImplementedError(this.name, 'freezeCard');
  }

  /** @returns {Promise<ProviderResult>} */
  async unfreezeCard(_providerRef) {
    throw new ProviderNotImplementedError(this.name, 'unfreezeCard');
  }

  /** @returns {Promise<ProviderResult>} */
  async closeCard(_providerRef) {
    throw new ProviderNotImplementedError(this.name, 'closeCard');
  }
}

module.exports = { CardIssuingProvider };
