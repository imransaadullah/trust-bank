const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

// Same shape as ledgerClient.js/paymentsClient.js — this backend only
// ever acts as one tenant, so the tenant id is baked in from config
// rather than threaded through every call site.
class CardsClient {
  constructor() {
    this.baseUrl = config.cards.baseUrl;
    this.apiKey = config.cards.apiKey;
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
      logger.error(`[CardsClient] ${method} ${path} failed: ${status} ${JSON.stringify(body)}`);
      const err = new Error(body?.error || error.message || 'Cards request failed');
      err.status = status;
      err.cardsErrorBody = body;
      throw err;
    }
  }

  issueCard({ externalCustomerId, dailySpendLimitKobo, singleTxnLimitKobo }) {
    return this._request('POST', `/v1/tenants/${this.tenantId}/cards`, {
      externalCustomerId, dailySpendLimitKobo, singleTxnLimitKobo,
    });
  }

  listCards(externalCustomerId) {
    return this._request('GET', `/v1/tenants/${this.tenantId}/customers/${encodeURIComponent(externalCustomerId)}/cards`);
  }

  freezeCard(cardId) {
    return this._request('POST', `/v1/tenants/${this.tenantId}/cards/${cardId}/freeze`);
  }

  unfreezeCard(cardId) {
    return this._request('POST', `/v1/tenants/${this.tenantId}/cards/${cardId}/unfreeze`);
  }

  closeCard(cardId) {
    return this._request('POST', `/v1/tenants/${this.tenantId}/cards/${cardId}/close`);
  }
}

module.exports = new CardsClient();
