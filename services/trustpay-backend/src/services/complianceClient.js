const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

// Compliance wraps responses in { success, data } same as Payments (not
// the Ledger's bare-object shape) — see the note in paymentsClient.js
// about the bug that caught this mismatch once already.
class ComplianceClient {
  constructor() {
    this.baseUrl = config.compliance.baseUrl;
    this.sharedSecret = config.compliance.sharedSecret;
    this.tenantId = config.tenantId;
  }

  async _request(method, path, data) {
    try {
      const response = await axios({
        method, url: `${this.baseUrl}${path}`, data,
        headers: { Authorization: `Bearer ${this.sharedSecret}`, 'Content-Type': 'application/json' },
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
}

module.exports = new ComplianceClient();
