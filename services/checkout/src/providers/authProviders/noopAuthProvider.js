const { AuthProvider } = require('./authProvider');
const logger = require('../../utils/logger');

// This slice's actual live-verification target — no live AuthCore project
// credentials exist in any environment this gets tested in, same posture
// NoopCheckoutProvider already takes for payment rails. Deliberately not a
// rubber stamp: a fixed, documented code ("000000") is the only one that
// verifies, so both the success path and a real "wrong code" rejection are
// still genuinely exercised, not bypassed.
const NOOP_CODE = '000000';

class NoopAuthProvider extends AuthProvider {
  constructor() {
    super('noop');
  }

  async sendOtp(email) {
    logger.info(`[NoopAuthProvider] would send OTP to ${email} — use code ${NOOP_CODE} to verify`);
    return { sent: true };
  }

  async verifyOtp(email, code) {
    return {
      verified: code === NOOP_CODE,
      email: code === NOOP_CODE ? email : null,
      providerUid: `noop_${email}`,
    };
  }
}

module.exports = { NoopAuthProvider, NOOP_CODE };
