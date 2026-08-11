const crypto = require('crypto');
const axios = require('axios');
const { PaymentsProvider } = require('./provider');
const logger = require('../utils/logger');

// Ported from core-banking/src/providers/paystackProvider.js (the old
// single-tenant Node core-banking service) — same Paystack API shapes,
// adapted to take a tenant's own credentials per instance instead of a
// single process-wide secret key, since this service is multi-tenant.
class PaystackProvider extends PaymentsProvider {
  constructor(credentials) {
    super('paystack');
    this.secretKey = credentials.secretKey;
    this.webhookSecret = credentials.webhookSecret || credentials.secretKey;
    this.preferredBank = credentials.preferredBank || 'wema-bank';
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
        logger.error(`[Paystack] ${method} ${path} failed: ${axiosError.response.status} – ${msg}`);
        throw new Error(`PaystackProvider: ${msg}`);
      }
      throw axiosError;
    }

    if (response.data.status === false) {
      throw new Error(`PaystackProvider: ${response.data.message}`);
    }
    return response.data;
  }

  async provisionAccount({ externalCustomerId, email, firstName, lastName, phoneNumber }) {
    const customerResult = await this._request('POST', '/customer', {
      email: email || `${externalCustomerId.replace(/[^a-zA-Z0-9]/g, '')}@trustbank.app`,
      first_name: firstName || 'User',
      last_name: lastName || externalCustomerId,
      phone: phoneNumber,
    });
    const customerCode = customerResult.data.customer_code;

    const dvaResult = await this._request('POST', '/dedicated_account', {
      customer: customerCode,
      preferred_bank: this.preferredBank,
    });
    const dva = dvaResult.data;

    return {
      accountNumber: dva.dedicated_account?.account_number || dva.account_number,
      bankName: dva.dedicated_account?.bank?.name || 'Wema Bank',
      bankCode: dva.dedicated_account?.bank?.slug || this.preferredBank,
      metadata: { customerCode, provider: 'paystack', raw: dva },
    };
  }

  async verifyIdentity({ type, number, firstName, lastName }) {
    const path = type === 'nin' ? '/nin/match' : '/bvn/match';
    const result = await this._request('POST', path, { [type]: number, first_name: firstName, last_name: lastName });
    const data = result.data || {};
    if (typeof data.first_name === 'boolean' || typeof data.last_name === 'boolean') {
      return { verified: !!(data.first_name && data.last_name) };
    }
    return { verified: true, matchedName: [data.first_name, data.last_name].filter(Boolean).join(' ') };
  }

  async verifyBeneficiary({ accountNumber, bankCode }) {
    const result = await this._request('GET', `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
    if (!result.data) return null;
    return { accountName: result.data.account_name };
  }

  async initiateOutbound({ amount, beneficiaryAccountNumber, beneficiaryBankCode, beneficiaryName, reference, description }) {
    const recipientResult = await this._request('POST', '/transferrecipient', {
      type: 'nuban',
      name: beneficiaryName || 'Recipient',
      account_number: beneficiaryAccountNumber,
      bank_code: beneficiaryBankCode,
      currency: 'NGN',
    });
    const recipientCode = recipientResult.data.recipient_code;

    const transferResult = await this._request('POST', '/transfer', {
      source: 'balance',
      amount,
      recipient: recipientCode,
      reason: description || 'TrustBank payout',
      reference,
    });

    return {
      providerRef: transferResult.data.reference || transferResult.data.transfer_code,
      status: transferResult.data.status === 'success' ? 'completed' : 'processing',
    };
  }

  async getBankList() {
    const result = await this._request('GET', '/bank?country=nigeria');
    return (result.data || []).map((b) => ({ code: b.code, name: b.name }));
  }

  async getTransferStatus(reference) {
    const result = await this._request('GET', `/transfer/verify/${encodeURIComponent(reference)}`);
    const paystackStatus = result.data?.status;
    if (paystackStatus === 'success') return { status: 'completed' };
    if (paystackStatus === 'failed' || paystackStatus === 'reversed') {
      return { status: 'failed', failureReason: result.data?.message || 'Provider confirmed transfer failure' };
    }
    return { status: 'processing' };
  }

  verifyWebhookSignature(rawBody, signature) {
    if (!signature) return false;
    try {
      const expected = crypto.createHmac('sha512', this.webhookSecret).update(rawBody).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch (error) {
      logger.error('[Paystack] Webhook verification error:', error.message);
      return false;
    }
  }

  parseWebhookEvent(eventBody) {
    const event = eventBody.event || 'unknown';
    const data = eventBody.data || {};

    switch (event) {
      case 'charge.success': {
        const accountNumber =
          data.authorization?.dedicated_account?.account_number ||
          data.metadata?.account_number ||
          data.dedicated_account?.account_number ||
          '';
        return {
          type: 'deposit',
          accountNumber,
          amount: data.amount || 0, // Paystack sends kobo already — no conversion needed
          providerRef: data.reference || data.id?.toString(),
          raw: eventBody,
        };
      }
      case 'transfer.success':
        return { type: 'withdrawal_success', amount: data.amount || 0, providerRef: data.reference, raw: eventBody };
      case 'transfer.failed':
        return {
          type: 'withdrawal_failed', amount: data.amount || 0, providerRef: data.reference,
          failureReason: data.reason || 'Paystack transfer failed', raw: eventBody,
        };
      default:
        return { type: 'unknown', raw: eventBody };
    }
  }
}

module.exports = { PaystackProvider };
