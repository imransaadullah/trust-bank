// Proves the bills contract fits both a real aggregator (Kuda) and a
// structurally different one (VTpass) before any real tenant needs the
// second one — same "stub, not skipped" discipline as
// providerConformance.test.js for payment rails.
const { BillsProvider } = require('../src/providers/billsProvider');
const { KudaBillsProvider } = require('../src/providers/kudaBillsProvider');
const { VtpassBillsProvider } = require('../src/providers/vtpassBillsProvider');
const { getBillsProvider, BILLS_PROVIDERS } = require('../src/providers/billsRegistry');

const CONTRACT_METHODS = ['getBillers', 'verifyBillCustomer', 'purchaseBill'];

describe('bills provider contract conformance', () => {
  test.each(Object.entries(BILLS_PROVIDERS))('%s implements every contract method', (name, ProviderClass) => {
    const instance = new ProviderClass({ email: 'x', apiKey: 'x', apiKey2: 'x', secretKey: 'x' });
    expect(instance).toBeInstanceOf(BillsProvider);
    for (const method of CONTRACT_METHODS) {
      expect(typeof instance[method]).toBe('function');
    }
  });

  test('registry resolves "kuda" to a KudaBillsProvider', () => {
    const provider = getBillsProvider('kuda', { email: 'x@x.com', apiKey: 'k' });
    expect(provider).toBeInstanceOf(KudaBillsProvider);
  });

  test('registry resolves "vtpass" to a VtpassBillsProvider', () => {
    const provider = getBillsProvider('vtpass', { apiKey: 'x', secretKey: 'y' });
    expect(provider).toBeInstanceOf(VtpassBillsProvider);
  });

  test('registry rejects an unknown provider name', () => {
    expect(() => getBillsProvider('does_not_exist', {})).toThrow('Unknown provider');
  });

  test.each(CONTRACT_METHODS)(
    'VtpassBillsProvider.%s rejects as not-implemented rather than silently no-op-ing',
    async (method) => {
      const provider = new VtpassBillsProvider({ apiKey: 'x', secretKey: 'y' });
      await expect(provider[method]({}, {})).rejects.toThrow('does not implement');
    },
  );
});
