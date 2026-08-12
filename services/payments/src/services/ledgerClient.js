const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class LedgerClient {
  constructor() {
    this.baseUrl = config.ledger.baseUrl;
    this.apiKey = config.ledger.apiKey;
  }

  async _request(tenantId, method, path, data) {
    try {
      const response = await axios({
        method,
        url: `${this.baseUrl}${path}`,
        data,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'X-Tenant-Id': tenantId,
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

  /** Confirms an inbound deposit the Payments service has already resolved from a provider webhook. */
  async confirmDeposit(tenantId, { externalCustomerId, amount, providerRef, reference, idempotencyKey, description }) {
    return this._request(tenantId, 'POST', '/v1/transfers/deposit/confirm', {
      externalCustomerId, amount, providerRef, reference, idempotencyKey, description,
    });
  }

  /** Reverses a journal entry — used when a provider payout fails after the caller already debited the customer. */
  async reverseJournalEntry(tenantId, journalEntryId, { reason, idempotencyKey }) {
    return this._request(tenantId, 'POST', `/v1/journal-entries/${journalEntryId}/reverse`, {
      reason, idempotencyKey,
    });
  }
}

module.exports = new LedgerClient();
