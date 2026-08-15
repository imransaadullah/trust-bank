const { IdentityProvider } = require('./identityProvider');

// Not implemented — exists so identityProvider.js's contract is proven
// against a second, differently-shaped identity provider before a real
// second market needs it, the same role selfIssuedNuban.js and
// vtpassBillsProvider.js already play for payment rails and bills.
// Twilio Verify chosen deliberately (a real, internationally-recognized
// phone-verification service, available well beyond Nigeria) rather than
// a placeholder name, so "the contract generalizes" means something
// concrete, not just theoretical.
//
// TODO before this can back a real tenant:
//   - sendOtp: POST /v2/Services/{ServiceSid}/Verifications
//   - verifyOtp: POST /v2/Services/{ServiceSid}/VerificationCheck,
//     map Twilio's own subject/account identifier to providerUid
class TwilioVerifyProvider extends IdentityProvider {
  constructor(config) {
    super('twilio_verify');
    this.accountSid = config.accountSid;
    this.authToken = config.authToken;
    this.serviceSid = config.serviceSid;
  }
}

module.exports = { TwilioVerifyProvider };
