const { ProviderNotImplementedError } = require('../../utils/errors');

/**
 * The contract every merchant-identity-verification provider implements —
 * same shape as this service's own CheckoutProvider contract, and mirrors
 * services/trustpay-backend's IdentityProvider pattern (phone-OTP via
 * AuthCore) almost exactly, extended to email since a Merchant only has
 * an email on file, not a phone. AuthCore is the only real implementation;
 * the contract is proven against a second, differently-shaped provider
 * (firebaseAuthProvider.js, a stub — AuthCore's own docs position it as a
 * Firebase Auth replacement, so that's the concrete second market this
 * platform would actually reach for) so this isn't secretly AuthCore-shaped,
 * and against noopAuthProvider.js, a genuine working stub for environments
 * with no live AuthCore project credentials — this service's own
 * NoopCheckoutProvider plays the identical role for payment rails.
 *
 * @typedef {Object} OtpVerification
 * @property {boolean} verified
 * @property {string|null} email
 * @property {string} providerUid
 */
class AuthProvider {
  constructor(name) {
    this.name = name;
  }

  /** Sends a one-time code to the given email. */
  async sendOtp(_email) {
    throw new ProviderNotImplementedError(this.name, 'sendOtp');
  }

  /** Verifies the code. @returns {Promise<OtpVerification>} */
  async verifyOtp(_email, _code) {
    throw new ProviderNotImplementedError(this.name, 'verifyOtp');
  }
}

module.exports = { AuthProvider };
