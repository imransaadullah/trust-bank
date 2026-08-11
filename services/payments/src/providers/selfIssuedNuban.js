const { PaymentsProvider } = require('./provider');

// Not implemented — exists so provider.js's contract is proven against a
// second, structurally different rail before a real bank tenant needs
// it. A licensed MFB/bank generates its own NUBAN (its own bank code +
// the standard CBN check-digit algorithm) instead of getting a Paystack
// DVA, and resolves inbound transfers via NIBSS — typically through a
// certified switching/settlement partner rather than direct NIBSS
// membership. When that's built, it plugs in here with zero changes to
// any caller (routes/, ledgerClient.js, or trustpay-backend), because
// they only ever talk to the PaymentsProvider contract, never to
// Paystack's or NIBSS's shapes directly.
//
// TODO before this can back a real tenant:
//   - provisionAccount: NUBAN generation (bank code + modulus-10 check digit)
//   - parseWebhookEvent / a NIBSS-partner-specific inbound notification format
//   - initiateOutbound: NIP outbound via the switching partner's API
class SelfIssuedNubanProvider extends PaymentsProvider {
  constructor(credentials) {
    super('self_issued_nuban');
    this.bankCode = credentials.bankCode;
  }
}

module.exports = { SelfIssuedNubanProvider };
