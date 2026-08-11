const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

// Unlike Payments' ledgerClient (which is multi-tenant and takes a
// tenantId per call), this backend only ever acts as one tenant — its
// own — so the tenant id is baked in from config rather than threaded
// through every call site.
class LedgerClient {
  constructor() {
    this.baseUrl = config.ledger.baseUrl;
    this.sharedSecret = config.ledger.sharedSecret;
    this.tenantId = config.tenantId;
  }

  async _request(method, path, data) {
    try {
      const response = await axios({
        method, url: `${this.baseUrl}${path}`, data,
        headers: {
          Authorization: `Bearer ${this.sharedSecret}`,
          'X-Tenant-Id': this.tenantId,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });
      return response.data;
    } catch (error) {
      const status = error.response?.status;
      const body = error.response?.data;
      logger.error(`[LedgerClient] ${method} ${path} failed: ${status} ${JSON.stringify(body)}`);
      const err = new Error(body?.error || error.message || 'Ledger request failed');
      err.status = status;
      err.ledgerErrorBody = body;
      throw err;
    }
  }

  openAccount({ externalCustomerId, productType, kycTier, currency }) {
    return this._request('POST', '/v1/accounts', { externalCustomerId, productType, kycTier, currency });
  }

  getAccountByCustomer(externalCustomerId) {
    return this._request('GET', `/v1/customers/${encodeURIComponent(externalCustomerId)}/account`);
  }

  getBalance(ledgerAccountId) {
    return this._request('GET', `/v1/accounts/${ledgerAccountId}/balance`);
  }

  transferP2P({ fromExternalCustomerId, toExternalCustomerId, amount, reference, idempotencyKey, description }) {
    return this._request('POST', '/v1/transfers/p2p', {
      fromExternalCustomerId, toExternalCustomerId, amount, reference, idempotencyKey, description,
    });
  }

  recordWithdrawal({ externalCustomerId, amount, reference, idempotencyKey, description }) {
    return this._request('POST', '/v1/transfers/withdrawal', {
      externalCustomerId, amount, reference, idempotencyKey, description,
    });
  }
}

module.exports = new LedgerClient();
