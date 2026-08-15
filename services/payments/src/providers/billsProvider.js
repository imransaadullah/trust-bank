const { ProviderNotImplementedError } = require('../utils/errors');

/**
 * The contract every biller aggregator implements — separate from
 * provider.js's PaymentsProvider contract deliberately: a tenant's
 * choice of payment rail (Paystack, a future self-issued NUBAN) and its
 * choice of bills aggregator (Kuda, VTpass) are independent decisions,
 * not the same axis. No biller is hardcoded anywhere outside this file
 * and billsRegistry.js — TrustPay might configure Kuda; a different
 * tenant might configure VTpass, or nothing at all.
 *
 * @typedef {Object} BillPlan
 * @property {string} code
 * @property {string} name
 * @property {number|null} amount minor units (kobo) — null if the customer picks the amount
 * @property {boolean} isFixedPrice
 *
 * @typedef {Object} Biller
 * @property {string} id
 * @property {string} name
 * @property {string} itemIdentifier
 * @property {string} type
 * @property {string} customerFieldName human-readable label for what "customerId" means (meter number, smartcard number, phone number)
 * @property {BillPlan[]} plans
 *
 * @typedef {Object} BillersResult
 * @property {boolean} success
 * @property {Biller[]} billers
 * @property {string} [error]
 *
 * @typedef {Object} CustomerVerification
 * @property {boolean} success
 * @property {string|null} customerName
 * @property {string} customerId
 * @property {string} billerCode
 * @property {string} [message]
 *
 * @typedef {Object} BillPurchaseResult
 * @property {boolean} success
 * @property {string|null} providerReference
 * @property {'processing'|'completed'|'failed'} status a provider accepting the request
 *   is not the same as confirming it — 'processing' means accepted, not yet
 *   confirmed; only checkPurchaseStatus (or a webhook, once one exists) may
 *   report 'completed'. Never assume acceptance means completion.
 * @property {string} [message]
 *
 * @typedef {Object} PurchaseStatus
 * @property {'processing'|'completed'|'failed'} status
 * @property {string} [failureReason]
 */
class BillsProvider {
  constructor(name) {
    this.name = name;
  }

  /** List billers, optionally filtered by type ('airtime'|'data'|'electricity'|'cable'). @returns {Promise<BillersResult>} */
  async getBillers(_type) {
    throw new ProviderNotImplementedError(this.name, 'getBillers');
  }

  /** Verify a customer's billing identifier before payment. @returns {Promise<CustomerVerification>} */
  async verifyBillCustomer(_billerCode, _customerId) {
    throw new ProviderNotImplementedError(this.name, 'verifyBillCustomer');
  }

  /** @returns {Promise<BillPurchaseResult>} */
  async purchaseBill(_input) {
    throw new ProviderNotImplementedError(this.name, 'purchaseBill');
  }

  /**
   * Poll the provider for a purchase's current status — the reconciliation
   * path for a 'processing' purchase that never resolved synchronously.
   * @returns {Promise<PurchaseStatus>}
   */
  async checkPurchaseStatus(_providerRef) {
    throw new ProviderNotImplementedError(this.name, 'checkPurchaseStatus');
  }
}

module.exports = { BillsProvider };
