// Ported from truechat/core-banking/src/providers/kudaProvider.js's bill
// methods — a real, previously-live integration, not written from a
// spec. Two deliberate adaptations from the source:
//   1. Amounts are kobo integers everywhere on this platform (see
//      CORE_BANKING_PLATFORM_ARCHITECTURE.md's convention) — the old
//      code took naira decimals at the route layer and converted; this
//      version skips that conversion since callers already pass kobo.
//   2. Extends BillsProvider (this platform's contract), constructed
//      with per-tenant decrypted credentials rather than reading a
//      single global `config.kuda.*` — Kuda is one tenant's choice, not
//      a platform-wide integration.
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { BillsProvider } = require('./billsProvider');
const logger = require('../utils/logger');

const BILL_TYPE_NAMES = {
  airtime: 'Airtime',
  data: 'Internet Data',
  electricity: 'Electricity',
  cable: 'CableTV',
};

const CUSTOMER_FIELD_NAMES = {
  airtime: 'phone number',
  data: 'phone number',
  electricity: 'meter number',
  cable: 'smart card number',
};

class KudaBillsProvider extends BillsProvider {
  constructor(credentials) {
    super('kuda');
    this.baseUrl = credentials.baseUrl || 'https://kuda-openapi.kuda.com/v2';
    this.email = credentials.email;
    this.apiKey = credentials.apiKey;
    this.accessToken = null;
    this.tokenExpiry = null;
    this._billerItemMap = new Map();
  }

  async _getAccessToken() {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await axios.post(
      `${this.baseUrl}/Account/GetToken`,
      { email: this.email, apiKey: this.apiKey },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 },
    );

    const token = typeof response.data === 'string' ? response.data : response.data && response.data.data;
    if (token && token.length > 20) {
      this.accessToken = token;
      this.tokenExpiry = Date.now() + 55 * 60 * 1000;
      return this.accessToken;
    }
    throw new Error('KudaBillsProvider: failed to obtain access token');
  }

  // requestRefOverride matters for purchaseBill specifically: BILL_TSQ
  // (checkPurchaseStatus) can look a purchase up by the exact requestRef
  // used to make it, so purchaseBill passes our own reference here
  // instead of letting one get auto-generated and discarded.
  async _makeRequest(serviceType, payload, innerKey = 'data', requestRefOverride) {
    const token = await this._getAccessToken();
    const requestRef = requestRefOverride || `REQ${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    let response;
    try {
      response = await axios.post(
        this.baseUrl,
        { serviceType, requestRef, [innerKey]: payload },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 60000 },
      );
    } catch (axiosError) {
      const respBody = axiosError.response?.data;
      const errMsg = respBody?.Message || respBody?.message || axiosError.message || 'Kuda API request failed';
      logger.warn(`[KudaBillsProvider] ${serviceType} request error: ${errMsg}`);
      return { success: false, error: errMsg, data: respBody };
    }

    const body = response.data || {};
    const isSuccess = body.status === true || body.Status === true || body.status === 'true' || body.Status === 'true';
    if (isSuccess) {
      return { success: true, data: body.data || body.Data || body };
    }
    const msg = body.message || body.Message || 'Kuda API error';
    logger.warn(`[KudaBillsProvider] ${serviceType} failed: ${msg}`);
    return { success: false, error: msg, data: body };
  }

  async _ensureItemIdentifier(billerCode) {
    if (this._billerItemMap.has(billerCode)) {
      return this._billerItemMap.get(billerCode);
    }
    for (const typeName of Object.values(BILL_TYPE_NAMES)) {
      try {
        const result = await this._makeRequest('GET_BILLERS_BY_TYPE', { BillTypeName: typeName });
        if (result.success && result.data) {
          for (const b of result.data.billers || []) {
            this._billerItemMap.set(b.id, b.id);
            for (const i of b.billItems || []) {
              const kid = i.kudaIdentifier || i.id;
              this._billerItemMap.set(b.id, kid);
              this._billerItemMap.set(kid, kid);
            }
          }
          if (this._billerItemMap.has(billerCode)) {
            return this._billerItemMap.get(billerCode);
          }
        }
      } catch {
        continue;
      }
    }
    return billerCode;
  }

  async getBillers(type) {
    const billTypeName = BILL_TYPE_NAMES[type];
    const result = billTypeName
      ? await this._makeRequest('GET_BILLERS_BY_TYPE', { BillTypeName: billTypeName })
      : await this._makeRequest('GET_BILLERS', {});

    if (!result.success || !result.data) {
      return { success: false, billers: [], error: result.error || 'Failed to fetch billers' };
    }

    const rawBillers = result.data.billers || [];
    this._billerItemMap.clear();

    const billers = rawBillers.map((b) => {
      const items = (b.billItems || []).filter((i) => i.isActive !== false);
      const firstItem = items[0];
      const itemId = firstItem ? firstItem.kudaIdentifier || firstItem.id : b.id;

      this._billerItemMap.set(b.id, itemId);
      items.forEach((i) => {
        if (i.kudaIdentifier) this._billerItemMap.set(i.kudaIdentifier, i.kudaIdentifier);
      });

      return {
        id: b.id,
        name: b.name,
        itemIdentifier: itemId,
        type: type || null,
        customerFieldName: CUSTOMER_FIELD_NAMES[type] || 'customer ID',
        // Amounts stay in kobo — Kuda's own amounts are already kobo-denominated.
        plans: items.map((i) => ({
          code: i.kudaIdentifier || i.id,
          name: i.name || b.name,
          amount: i.isFixedPrice && i.amount ? i.amount : null,
          isFixedPrice: !!i.isFixedPrice,
        })),
      };
    });

    return { success: true, billers };
  }

  async verifyBillCustomer(billerCode, customerId) {
    const itemIdentifier = await this._ensureItemIdentifier(billerCode);
    const result = await this._makeRequest(
      'VERIFY_BILL_CUSTOMER',
      { KudaBillItemIdentifier: itemIdentifier, CustomerIdentification: customerId },
      'Data',
    );

    if (result.success && result.data) {
      return {
        success: true,
        customerName: result.data.CustomerName || result.data.customerName || 'Verified',
        customerId, billerCode,
      };
    }
    return {
      success: false, customerName: null, customerId, billerCode,
      message: result.error || 'Customer verification failed',
    };
  }

  async purchaseBill({ billerCode, customerId, amount, planCode, trackingReference, customerName, phone }) {
    const ref = trackingReference || `BILL-${uuidv4()}`;
    const itemIdentifier = planCode || this._billerItemMap.get(billerCode) || (await this._ensureItemIdentifier(billerCode));
    const firstName = customerName ? customerName.split(' ')[0] : 'Customer';

    const payload = {
      CustomerFirstName: firstName,
      CustomerIdentifier: customerId,
      PhoneNumber: phone ? phone.replace(/^\+/, '') : customerId,
      BillItemIdentifier: itemIdentifier,
      // Kuda expects Amount as a kobo string.
      Amount: Math.round(amount).toString(),
    };

    const result = await this._makeRequest('ADMIN_PURCHASE_BILL', payload, 'data', ref);

    if (result.success && result.data) {
      // Acceptance, not confirmation — Kuda's own docs note tokens/PINs
      // "are not always returned in the purchase response depending on
      // the bill type," with confirmation following via the TSQ service
      // "after a few seconds" or a webhook. Never assume this response is
      // final; checkPurchaseStatus is what confirms it.
      return {
        success: true,
        providerReference: result.data.reference || result.data.TransactionReference || ref,
        status: 'processing',
        message: result.data.message || 'Bill purchase accepted, pending confirmation',
      };
    }
    return {
      success: false, providerReference: null, status: 'failed',
      message: result.error || 'Bill payment failed',
    };
  }

  // BILL_TSQ — "Check Bill Purchase Status." providerRef here is our own
  // reference (the requestRef purchaseBill used, per the note above),
  // passed as BillRequestRef rather than billResponseReference (Kuda's
  // own reference), since that's the one this codebase always has on
  // hand from a BillPaymentAttempt row without a second lookup.
  async checkPurchaseStatus(providerRef) {
    const result = await this._makeRequest('BILL_TSQ', { BillRequestRef: providerRef }, 'Data');

    if (!result.success || !result.data) {
      // Couldn't get a confirmed answer — stay processing rather than
      // guessing; the next reconciliation pass tries again.
      return { status: 'processing' };
    }

    const finalStatus = String(result.data.finalStatus || '').toLowerCase();
    if (finalStatus === 'successful') {
      return { status: 'completed' };
    }
    if (finalStatus.includes('fail') || finalStatus.includes('revers')) {
      return { status: 'failed', failureReason: result.data.finalStatus || 'Kuda reported the purchase failed' };
    }
    // Any other value (pending/processing/unrecognized) — conservative default.
    return { status: 'processing' };
  }
}

module.exports = { KudaBillsProvider };
