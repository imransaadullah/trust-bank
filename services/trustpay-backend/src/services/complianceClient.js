const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

// Compliance wraps responses in { success, data } same as Payments (not
// the Ledger's bare-object shape) — see the note in paymentsClient.js
// about the bug that caught this mismatch once already.
class ComplianceClient {
  constructor() {
    this.baseUrl = config.compliance.baseUrl;
    this.apiKey = config.compliance.apiKey;
    this.tenantId = config.tenantId;
  }

  async _request(method, path, data) {
    try {
      const response = await axios({
        method, url: `${this.baseUrl}${path}`, data,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      return response.data.data;
    } catch (error) {
      const status = error.response?.status;
      const body = error.response?.data;
      logger.error(`[ComplianceClient] ${method} ${path} failed: ${status} ${JSON.stringify(body)}`);
      const err = new Error(body?.error || error.message || 'Compliance request failed');
      err.status = status;
      err.complianceErrorBody = body;
      throw err;
    }
  }

  checkKYCTier({ userId, tier, amount, amountTransactedTodayKobo }) {
    return this._request('POST', `/v1/tenants/${this.tenantId}/compliance/kyc-tier-check`, {
      userId, tier, amount, amountTransactedTodayKobo,
    });
  }

  checkDevice({ userId, isNewDevice, deviceAgeHours, amount }) {
    return this._request('POST', `/v1/tenants/${this.tenantId}/compliance/device-check`, {
      userId, isNewDevice, deviceAgeHours, amount,
    });
  }

  // Rule-based, not ML — see services/compliance's screeningService.js.
  // Never throws on a flagged result; flags are for compliance's own
  // case queue, not a reason to block the caller's transaction.
  screenTransaction({ userId, amount, counterpartyId, recentTransactions, transactionRef }) {
    return this._request('POST', `/v1/tenants/${this.tenantId}/compliance/screen-transaction`, {
      userId, amount, counterpartyId, recentTransactions, transactionRef,
    });
  }

  // Unlike screenTransaction, a hit here is meant to block — see
  // enforceCompliance in wallet.js.
  screenSanctions({ userId, fullName }) {
    return this._request('POST', `/v1/tenants/${this.tenantId}/compliance/screen-sanctions`, {
      userId, fullName,
    });
  }
}

module.exports = new ComplianceClient();
