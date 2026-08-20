const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const tenantLedgerCredentialService = require('./tenantLedgerCredentialService');
const { CardsError } = require('../utils/errors');

class LedgerClient {
  constructor() {
    this.baseUrl = config.ledger.baseUrl;
  }

  async _request(tenantId, method, path, data) {
    try {
      // Ledger cross-checks X-Tenant-Id against the credential's own
      // bound tenant, so this must be this tenant's own operate-scope
      // credential, not a single shared one — see
      // TenantLedgerCredential's schema comment.
      const apiKey = await tenantLedgerCredentialService.get(tenantId);
      const response = await axios({
        method,
        url: `${this.baseUrl}${path}`,
        data,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-Tenant-Id': tenantId,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });
      return response.data;
    } catch (error) {
      if (error instanceof CardsError) {
        throw error;
      }
      const status = error.response?.status;
      const body = error.response?.data;
      logger.error(`[LedgerClient] ${method} ${path} failed: ${status} ${JSON.stringify(body)}`);
      const err = new Error(body?.error || error.message || 'Ledger request failed');
      err.status = status;
      err.ledgerErrorBody = body;
      throw err;
    }
  }

  /** Resolves a customer's wallet account — used to find the account id to check the balance of. */
  async getAccountByCustomer(tenantId, externalCustomerId) {
    return this._request(tenantId, 'GET', `/v1/customers/${encodeURIComponent(externalCustomerId)}/account`);
  }

  /** The live, real-time balance authorize() checks a requested amount against. */
  async getBalance(tenantId, ledgerAccountId) {
    return this._request(tenantId, 'GET', `/v1/accounts/${ledgerAccountId}/balance`);
  }

  /** Debits the customer's wallet for an approved, settled card transaction. */
  async recordCardSettlement(tenantId, { externalCustomerId, amount, reference, idempotencyKey, description }) {
    return this._request(tenantId, 'POST', '/v1/transfers/card-settlement', {
      externalCustomerId, amount, reference, idempotencyKey, description,
    });
  }
}

module.exports = new LedgerClient();
