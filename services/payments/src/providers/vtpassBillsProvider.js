const { BillsProvider } = require('./billsProvider');

// Not implemented — exists so billsProvider.js's contract is proven
// against a second, structurally different biller aggregator before a
// real tenant needs it, the same role selfIssuedNuban.js plays for
// payment rails. VTpass's actual API is REST/JSON-per-operation (service
// ID + variation codes) rather than Kuda's single-endpoint
// serviceType-discriminated style — a genuinely different shape, which
// is the point: proving the contract isn't secretly Kuda-shaped.
//
// TODO before this can back a real tenant:
//   - getBillers: GET https://vtpass.com/api/service-categories + /services?identifier=
//   - verifyBillCustomer: GET /merchant-verify (meter/smartcard/phone lookup)
//   - purchaseBill: POST /pay with a request-id idempotency key
class VtpassBillsProvider extends BillsProvider {
  constructor(credentials) {
    super('vtpass');
    this.apiKey = credentials.apiKey;
    this.secretKey = credentials.secretKey;
  }
}

module.exports = { VtpassBillsProvider };
