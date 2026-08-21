const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const tenantLedgerCredentialService = require('./tenantLedgerCredentialService');
const { getHttpsAgent } = require('../tls/mtls');
const { CheckoutError } = require('../utils/errors');

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
        httpsAgent: getHttpsAgent(),
        timeout: 10000,
      });
      return response.data;
    } catch (error) {
      if (error instanceof CheckoutError) {
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

  /** Opens a merchant's own wallet account at onboarding time — required before
   * confirmDeposit can ever credit it (the Ledger never auto-creates one). */
  async openAccount(tenantId, { externalCustomerId, productType, kycTier, currency }) {
    return this._request(tenantId, 'POST', '/v1/accounts', { externalCustomerId, productType, kycTier, currency });
  }

  /** Used by live verification to confirm a merchant's account really exists. */
  async getAccountByCustomer(tenantId, externalCustomerId) {
    return this._request(tenantId, 'GET', `/v1/customers/${encodeURIComponent(externalCustomerId)}/account`);
  }

  /** Credits the merchant's wallet for a completed checkout session. */
  async confirmDeposit(tenantId, { externalCustomerId, amount, providerRef, reference, idempotencyKey, description }) {
    return this._request(tenantId, 'POST', '/v1/transfers/deposit/confirm', {
      externalCustomerId, amount, providerRef, reference, idempotencyKey, description,
    });
  }
}

module.exports = new LedgerClient();
