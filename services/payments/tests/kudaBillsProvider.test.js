// Request-shape unit tests against a mocked axios — same "real DB, faked
// external network" discipline as reconciliation.test.js, just faking
// the network entirely here since there's no DB involvement at this
// layer. A live call against Kuda's real token endpoint (with fake
// credentials, genuinely rejected) is done as part of the manual live
// end-to-end verification pass, not as an automated test — same as how
// Paystack's live rejection was verified.
jest.mock('axios');
const axios = require('axios');
const { KudaBillsProvider } = require('../src/providers/kudaBillsProvider');

function provider() {
  return new KudaBillsProvider({ email: 'ops@trustpay.example', apiKey: 'fake-key', baseUrl: 'https://kuda.example/v2' });
}

function mockToken() {
  axios.post.mockResolvedValueOnce({ data: { data: 'a'.repeat(40) } });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('KudaBillsProvider.getBillers', () => {
  test('requests GET_BILLERS_BY_TYPE with the mapped BillTypeName for a known type', async () => {
    mockToken();
    axios.post.mockResolvedValueOnce({
      data: { status: true, data: { billers: [{ id: 'b1', name: 'MTN', billItems: [{ id: 'i1', kudaIdentifier: 'ki1', isFixedPrice: true, amount: 10000 }] }] } },
    });

    const result = await provider().getBillers('airtime');

    expect(axios.post).toHaveBeenNthCalledWith(2, 'https://kuda.example/v2', expect.objectContaining({
      serviceType: 'GET_BILLERS_BY_TYPE',
      data: { BillTypeName: 'Airtime' },
    }), expect.any(Object));
    expect(result.success).toBe(true);
    expect(result.billers[0]).toMatchObject({ id: 'b1', name: 'MTN', customerFieldName: 'phone number' });
    // Amounts stay in kobo — no naira conversion.
    expect(result.billers[0].plans[0].amount).toBe(10000);
  });

  test('falls back to GET_BILLERS when the type is unrecognized', async () => {
    mockToken();
    axios.post.mockResolvedValueOnce({ data: { status: true, data: { billers: [] } } });

    await provider().getBillers('unknown-type');

    expect(axios.post).toHaveBeenNthCalledWith(2, 'https://kuda.example/v2', expect.objectContaining({
      serviceType: 'GET_BILLERS',
    }), expect.any(Object));
  });

  test('returns success:false without throwing when Kuda reports failure', async () => {
    mockToken();
    axios.post.mockResolvedValueOnce({ data: { status: false, message: 'Service unavailable' } });

    const result = await provider().getBillers('airtime');
    expect(result).toEqual({ success: false, billers: [], error: 'Service unavailable' });
  });
});

describe('KudaBillsProvider.verifyBillCustomer', () => {
  test('sends VERIFY_BILL_CUSTOMER with PascalCase params under a capital-D "Data" key', async () => {
    mockToken();
    // _ensureItemIdentifier's lookup loop (4 GET_BILLERS_BY_TYPE calls, all empty)
    for (let i = 0; i < 4; i++) axios.post.mockResolvedValueOnce({ data: { status: true, data: { billers: [] } } });
    axios.post.mockResolvedValueOnce({ data: { status: true, data: { CustomerName: 'Ada Lovelace' } } });

    const result = await provider().verifyBillCustomer('biller-1', '1234567890');

    const verifyCall = axios.post.mock.calls[5];
    expect(verifyCall[1]).toMatchObject({
      serviceType: 'VERIFY_BILL_CUSTOMER',
      Data: { KudaBillItemIdentifier: 'biller-1', CustomerIdentification: '1234567890' },
    });
    expect(result).toMatchObject({ success: true, customerName: 'Ada Lovelace' });
  });
});

describe('KudaBillsProvider.purchaseBill', () => {
  test('sends ADMIN_PURCHASE_BILL with the amount as a kobo string, not naira-converted', async () => {
    mockToken();
    axios.post.mockResolvedValueOnce({ data: { status: true, data: { reference: 'kuda-ref-1' } } });

    const result = await provider().purchaseBill({
      billerCode: 'biller-1', customerId: '1234567890', amount: 150000,
      planCode: 'plan-1', trackingReference: 'BILL-1', customerName: 'Ada Lovelace', phone: '+2348010000000',
    });

    const purchaseCall = axios.post.mock.calls[1];
    expect(purchaseCall[1]).toMatchObject({
      serviceType: 'ADMIN_PURCHASE_BILL',
      data: {
        CustomerFirstName: 'Ada',
        CustomerIdentifier: '1234567890',
        PhoneNumber: '2348010000000',
        BillItemIdentifier: 'plan-1',
        Amount: '150000',
      },
    });
    expect(result).toMatchObject({ success: true, providerReference: 'kuda-ref-1', status: 'completed' });
  });

  test('returns a failed result without throwing when Kuda rejects the purchase', async () => {
    mockToken();
    axios.post.mockResolvedValueOnce({ data: { status: false, message: 'Insufficient pool balance' } });

    const result = await provider().purchaseBill({
      billerCode: 'biller-1', customerId: '1234567890', amount: 150000, planCode: 'plan-1', trackingReference: 'BILL-2',
    });

    expect(result).toEqual({ success: false, providerReference: null, status: 'failed', message: 'Insufficient pool balance' });
  });
});

describe('KudaBillsProvider token acquisition', () => {
  test('caches the token across calls within the same instance', async () => {
    mockToken();
    axios.post.mockResolvedValueOnce({ data: { status: true, data: { billers: [] } } });
    axios.post.mockResolvedValueOnce({ data: { status: true, data: { billers: [] } } });

    const p = provider();
    await p.getBillers('airtime');
    await p.getBillers('data');

    // 1 token call + 2 bill calls = 3, not 4 — the second getBillers call
    // reused the cached token instead of re-authenticating.
    expect(axios.post).toHaveBeenCalledTimes(3);
  });
});
