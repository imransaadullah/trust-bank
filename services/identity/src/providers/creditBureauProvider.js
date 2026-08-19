const { ProviderNotImplementedError } = require('../utils/errors');

/**
 * The contract a real credit bureau integration (CRC Credit Bureau,
 * FirstCentral) would implement — mirrors services/payments'
 * PaymentsProvider pattern (one abstract base, swappable concrete
 * providers), scoped to the single operation this platform needs today.
 * No real provider exists yet; src/services/creditBureauRunner.js runs
 * against noopCreditBureauProvider.js until one does.
 *
 * @typedef {Object} LoanRecord
 * @property {string} tenantId
 * @property {string} externalCustomerId
 * @property {string} loanAccountId
 * @property {number} principalKobo
 * @property {number} annualRateBps
 * @property {string|null} maturityDate
 * @property {number} balance
 * @property {number} daysPastDue
 * @property {string} bucket
 * @property {string} status
 * @property {null} customerIdentity verified name/BVN a real submission
 *   needs — always null here. That data lives in each tenant's own
 *   product backend (e.g. trustpay-backend's User.verifiedFullName), not
 *   in this tenant-agnostic core, and no generic customer-KYC-profile
 *   bounded context exists in this platform yet. Wiring a calling
 *   backend to supply it (or building that service) is real, separate
 *   future work — not attempted here.
 *
 * @typedef {Object} SubmissionResult
 * @property {boolean} submitted
 * @property {string|null} providerRef
 */
class CreditBureauProvider {
  constructor(name) {
    this.name = name;
  }

  /** @param {LoanRecord} _record @returns {Promise<SubmissionResult>} */
  async submitLoanRecord(_record) {
    throw new ProviderNotImplementedError(this.name, 'submitLoanRecord');
  }
}

module.exports = { CreditBureauProvider };
