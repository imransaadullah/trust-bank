const { ProviderNotImplementedError } = require('../utils/errors');

/**
 * The contract any email-delivery mechanism implements — same
 * one-abstract-base/swappable-concrete-provider pattern as
 * CreditBureauProvider/CardIssuingProvider. Scoped narrowly to the one
 * real need today (password reset), not a generic "send arbitrary
 * email" abstraction — widen it if a second real use case shows up.
 *
 * @typedef {Object} SendResult
 * @property {boolean} sent
 */
class EmailProvider {
  constructor(name) {
    this.name = name;
  }

  /**
   * @param {{to: string, resetToken: string, expiresInMinutes: number}} _input
   * @returns {Promise<SendResult>}
   */
  async sendPasswordResetEmail(_input) {
    throw new ProviderNotImplementedError(this.name, 'sendPasswordResetEmail');
  }
}

module.exports = { EmailProvider };
