const crypto = require('crypto');
const axios = require('axios');
const { CheckoutProvider } = require('./checkoutProvider');
const logger = require('../utils/logger');

// Real Paystack hosted-checkout integration — /transaction/initialize
// and /transaction/verify/:reference, the same base URL, secret-key
// auth header, and HMAC-SHA512 webhook scheme
// services/payments/src/providers/paystack.js already uses live for
// DVA/payout calls. This is the *same* underlying Paystack merchant
// account a tenant already configured there — a different, standard
// endpoint on the same API, not a new commercial relationship — but its
// own separate encrypted credential store here (TenantCheckoutProviderConfig),
// per this platform's convention of never sharing credentials across
// service boundaries (confirmed by Cards' own TenantCardProviderConfig).
//
// Live-verified only if a real test-mode secret key is available in
// this environment; otherwise shape-verified only (correct request/
// response field mapping, correct signature check) — same disclosure
// Cards used for its own real card-issuing provider contract.
class PaystackCheckoutProvider extends CheckoutProvider {
  constructor(credentials) {
    super('paystack');
    this.secretKey = credentials.secretKey;
    this.webhookSecret = credentials.webhookSecret || credentials.secretKey;
    this.baseUrl = 'https://api.paystack.co';
  }

  async _request(method, path, data = null) {
    let response;
    try {
      response = await axios({
        method,
        url: `${this.baseUrl}${path}`,
        data,
        headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      });
    } catch (axiosError) {
      if (axiosError.response?.data) {
        const msg = axiosError.response.data.message || JSON.stringify(axiosError.response.data);
        logger.error(`[PaystackCheckout] ${method} ${path} failed: ${axiosError.response.status} – ${msg}`);
        throw new Error(`PaystackCheckoutProvider: ${msg}`);
      }
      throw axiosError;
    }

    if (response.data.status === false) {
      throw new Error(`PaystackCheckoutProvider: ${response.data.message}`);
    }
    return response.data;
  }

  async initializeTransaction({ reference, amountKobo, email, callbackUrl, metadata }) {
    const result = await this._request('POST', '/transaction/initialize', {
      email, amount: amountKobo, reference, callback_url: callbackUrl, currency: 'NGN', metadata,
    });
    return { authorizationUrl: result.data.authorization_url, providerRef: result.data.reference };
  }

  async verifyTransaction(reference) {
    const result = await this._request('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    const data = result.data || {};
    const status = data.status === 'success' ? 'success' : (data.status === 'abandoned' ? 'abandoned' : 'failed');
    return { status, amountKobo: data.amount || 0, paidAt: data.paid_at || null, raw: data };
  }

  verifyWebhookSignature(rawBody, headers) {
    const signature = headers['x-paystack-signature'];
    if (!signature) return false;
    try {
      const expected = crypto.createHmac('sha512', this.webhookSecret).update(rawBody).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch (error) {
      logger.error(`[PaystackCheckout] webhook verification error: ${error.message}`);
      return false;
    }
  }

  parseWebhookEvent(eventBody) {
    if (eventBody.event !== 'charge.success') return { type: 'unknown', raw: eventBody };
    const data = eventBody.data || {};
    return {
      type: 'charge.success',
      reference: data.reference,
      amountKobo: data.amount || 0, // Paystack sends kobo already — no conversion needed
      paidAt: data.paid_at || null,
      raw: eventBody,
    };
  }
}

module.exports = { PaystackCheckoutProvider };
