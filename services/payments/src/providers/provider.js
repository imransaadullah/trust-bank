const { ProviderNotImplementedError } = require('../utils/errors');

/**
 * The contract every payment rail implements. TrustPay rides on Paystack
 * today (no banking license); a real MFB/bank tenant would implement
 * this same contract by generating its own NUBAN and settling via NIBSS
 * (typically through a certified switching partner) instead — see
 * selfIssuedNuban.js, which implements this shape but not the behavior
 * yet. Nothing outside a provider file should know which rail a tenant
 * is on.
 *
 * @typedef {Object} ProvisionedAccount
 * @property {string} accountNumber
 * @property {string} bankName
 * @property {string} bankCode
 * @property {Object} metadata
 *
 * @typedef {Object} WebhookEvent
 * @property {'deposit'|'withdrawal_success'|'withdrawal_failed'|'unknown'} type
 * @property {string} [accountNumber]
 * @property {number} [amount] minor units (kobo)
 * @property {string} [providerRef]
 * @property {string} [failureReason]
 * @property {Object} raw
 *
 * @typedef {Object} IdentityVerification
 * @property {boolean} verified
 * @property {string} [matchedName]
 *
 * @typedef {Object} BeneficiaryLookup
 * @property {string} accountName
 *
 * @typedef {Object} OutboundResult
 * @property {string} providerRef
 * @property {'processing'|'completed'|'failed'} status
 */
class PaymentsProvider {
  constructor(name) {
    this.name = name;
  }

  /** @returns {Promise<ProvisionedAccount>} */
  async provisionAccount(_input) {
    throw new ProviderNotImplementedError(this.name, 'provisionAccount');
  }

  /** BVN/NIN match against the provider's identity verification API. @returns {Promise<IdentityVerification>} */
  async verifyIdentity(_input) {
    throw new ProviderNotImplementedError(this.name, 'verifyIdentity');
  }

  /** Name enquiry on a beneficiary account before a payout. @returns {Promise<BeneficiaryLookup|null>} */
  async verifyBeneficiary(_input) {
    throw new ProviderNotImplementedError(this.name, 'verifyBeneficiary');
  }

  /** @returns {Promise<OutboundResult>} */
  async initiateOutbound(_input) {
    throw new ProviderNotImplementedError(this.name, 'initiateOutbound');
  }

  /** @returns {Promise<Array<{code: string, name: string}>>} */
  async getBankList() {
    throw new ProviderNotImplementedError(this.name, 'getBankList');
  }

  /** Verify a webhook's signature over the raw request body. Must not throw — return false on failure. */
  verifyWebhookSignature(_rawBody, _signature) {
    throw new ProviderNotImplementedError(this.name, 'verifyWebhookSignature');
  }

  /** Normalize a provider webhook payload into a WebhookEvent. @returns {WebhookEvent} */
  parseWebhookEvent(_eventBody) {
    throw new ProviderNotImplementedError(this.name, 'parseWebhookEvent');
  }
}

module.exports = { PaymentsProvider };
