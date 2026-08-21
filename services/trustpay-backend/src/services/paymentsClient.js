const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { getHttpsAgent } = require('../tls/mtls');

class PaymentsClient {
  constructor() {
    this.baseUrl = config.payments.baseUrl;
    this.apiKey = config.payments.apiKey;
    this.tenantId = config.tenantId;
  }

  async _request(method, path, data) {
    try {
      const response = await axios({
        method, url: `${this.baseUrl}${path}`, data,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        httpsAgent: getHttpsAgent(),
        timeout: 15000,
      });
      // Unlike the Ledger (Go) service, Payments wraps every response in
      // { success, data } — unwrap it here so callers get the payload
      // directly, matching ledgerClient's shape.
      return response.data.data;
    } catch (error) {
      const status = error.response?.status;
      const body = error.response?.data;
      logger.error(`[PaymentsClient] ${method} ${path} failed: ${status} ${JSON.stringify(body)}`);
      const err = new Error(body?.error || error.message || 'Payments request failed');
      err.status = status;
      err.paymentsErrorBody = body;
      throw err;
    }
  }

  provisionAccount({ externalCustomerId, email, firstName, lastName, phoneNumber, currency }) {
    return this._request('POST', `/v1/tenants/${this.tenantId}/accounts`, {
      externalCustomerId, email, firstName, lastName, phoneNumber, currency,
    });
  }

  getAccount(externalCustomerId) {
    return this._request('GET', `/v1/tenants/${this.tenantId}/accounts/${encodeURIComponent(externalCustomerId)}`);
  }

  verifyIdentity({ type, number, firstName, lastName }) {
    return this._request('POST', `/v1/tenants/${this.tenantId}/identity/verify`, { type, number, firstName, lastName });
  }

  initiatePayout({ externalCustomerId, amount, beneficiaryAccountNumber, beneficiaryBankCode, beneficiaryName, reference, debitJournalEntryId, description }) {
    return this._request('POST', `/v1/tenants/${this.tenantId}/payouts`, {
      externalCustomerId, amount, beneficiaryAccountNumber, beneficiaryBankCode,
      beneficiaryName, reference, debitJournalEntryId, description,
    });
  }

  getBillers(type) {
    const query = type ? `?type=${encodeURIComponent(type)}` : '';
    return this._request('GET', `/v1/tenants/${this.tenantId}/bills/billers${query}`);
  }

  verifyBillCustomer({ billerCode, customerId }) {
    return this._request('POST', `/v1/tenants/${this.tenantId}/bills/verify`, { billerCode, customerId });
  }

  purchaseBill({ externalCustomerId, billerCode, customerId, amount, planCode, customerName, phone, reference, debitJournalEntryId }) {
    return this._request('POST', `/v1/tenants/${this.tenantId}/bills/purchase`, {
      externalCustomerId, billerCode, customerId, amount, planCode,
      customerName, phone, reference, debitJournalEntryId,
    });
  }
}

module.exports = new PaymentsClient();
