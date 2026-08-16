const crypto = require('crypto');
const { PaymentsProvider } = require('./provider');

// CBN/NIBSS's own check-digit algorithm — public and standardized, not
// proprietary to any one bank (see the "Revised Standards on Nigeria
// Uniform Bank Account Number (NUBAN)" circular). Verified against the
// circular's own worked example before trusting it here: First Bank
// (code 011), serial 000000022 -> weighted sum 30 -> check digit 0 ->
// final NUBAN 0000000220 — reproduced independently in this file's tests,
// and cross-checked against an unrelated open-source implementation.
const NUBAN_WEIGHTS = [3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3];

/**
 * @param {string} bankCode 3-digit CBN-assigned bank code
 * @param {string} serial 9-digit account serial
 * @returns {number} the single check digit, 0-9
 */
function computeNubanCheckDigit(bankCode, serial) {
  if (!/^\d{3}$/.test(bankCode)) throw new Error('computeNubanCheckDigit: bankCode must be exactly 3 digits');
  if (!/^\d{9}$/.test(serial)) throw new Error('computeNubanCheckDigit: serial must be exactly 9 digits');
  const digits = (bankCode + serial).split('').map(Number);
  const sum = digits.reduce((total, d, i) => total + d * NUBAN_WEIGHTS[i], 0);
  const checkDigit = 10 - (sum % 10);
  return checkDigit === 10 ? 0 : checkDigit;
}

// NOT a real bank's serial-allocation policy. A licensed bank normally
// allocates the 9-digit serial sequentially (often branch-coded) from its
// own core system — CBN doesn't mandate a scheme, it's the bank's own
// choice. This is a deterministic stand-in (stable per externalCustomerId,
// so provisionAccount needs no persistence of its own) that exists only
// to make the provider's shape complete before a real tenant needs it.
// It is NOT collision-safe: a hash into a 9-digit space starts colliding
// around the tens-of-thousands-of-customers mark (birthday bound). Replace
// this before any real tenant relies on it — see the TODO below.
function deriveSerial(externalCustomerId) {
  const hash = crypto.createHash('sha256').update(externalCustomerId).digest();
  const n = hash.readUInt32BE(0) % 1_000_000_000;
  return String(n).padStart(9, '0');
}

// Real NUBAN generation (computeNubanCheckDigit above) is the one piece of
// a self-issued rail that doesn't need a live NIBSS/switching-partner
// relationship to be correct — it's pure, public-spec math. Everything
// else here still needs that relationship's actual, partner-specific
// shape, and stays a not-implemented stub rather than guessed at.
//
// TODO before this can back a real tenant:
//   - deriveSerial: a real sequential/branch-coded allocation policy,
//     coordinated with the bank's own core system — not a hash
//   - parseWebhookEvent / a NIBSS-partner-specific inbound notification format
//   - initiateOutbound: NIP outbound via the switching partner's API
//   - verifyIdentity / verifyBeneficiary / getBankList: whatever the
//     switching partner's own APIs for these turn out to be
class SelfIssuedNubanProvider extends PaymentsProvider {
  constructor(credentials) {
    super('self_issued_nuban');
    this.bankCode = credentials.bankCode;
    this.bankName = credentials.bankName || null;
  }

  /** @returns {Promise<import('./provider').ProvisionedAccount>} */
  async provisionAccount({ externalCustomerId }) {
    if (!this.bankCode) {
      throw new Error('SelfIssuedNubanProvider: bankCode is not configured for this tenant');
    }
    const serial = deriveSerial(externalCustomerId);
    const checkDigit = computeNubanCheckDigit(this.bankCode, serial);
    return {
      accountNumber: serial + checkDigit,
      bankName: this.bankName,
      bankCode: this.bankCode,
      metadata: { provider: 'self_issued_nuban', serial },
    };
  }
}

module.exports = { SelfIssuedNubanProvider, computeNubanCheckDigit };
