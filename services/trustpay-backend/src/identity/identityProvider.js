const { ProviderNotImplementedError } = require('../utils/errors');

/**
 * The contract every phone-verification/identity provider implements —
 * same shape as services/payments' PaymentsProvider/BillsProvider
 * contracts, for the same reason: nothing outside a provider file should
 * assume which vendor is behind sign-in. AuthCore (Nigeria) is the only
 * real implementation; the contract is proven against a second,
 * differently-shaped provider (twilioVerifyProvider.js, a stub) so this
 * isn't secretly AuthCore-shaped.
 *
 * @typedef {Object} OtpVerification
 * @property {boolean} verified
 * @property {string|null} phoneNumber
 * @property {string} providerUid
 */
class IdentityProvider {
  constructor(name) {
    this.name = name;
  }

  /** Sends a one-time code to the given E.164 phone number. */
  async sendOtp(_phoneNumber) {
    throw new ProviderNotImplementedError(this.name, 'sendOtp');
  }

  /** Verifies the code. @returns {Promise<OtpVerification>} */
  async verifyOtp(_phoneNumber, _code) {
    throw new ProviderNotImplementedError(this.name, 'verifyOtp');
  }
}

module.exports = { IdentityProvider };
