// Proves the interface actually fits both a real rail (Paystack) and a
// structurally different one (self-issued NUBAN) before any real bank
// tenant needs the second one — the point of the plan's "stub, not
// skipped" decision.
const { PaymentsProvider } = require('../src/providers/provider');
const { PaystackProvider } = require('../src/providers/paystack');
const { SelfIssuedNubanProvider } = require('../src/providers/selfIssuedNuban');
const { getProvider, PROVIDERS } = require('../src/providers/registry');

const CONTRACT_METHODS = [
  'provisionAccount', 'verifyIdentity', 'verifyBeneficiary', 'initiateOutbound',
  'getBankList', 'verifyWebhookSignature', 'parseWebhookEvent',
];

describe('provider contract conformance', () => {
  test.each(Object.entries(PROVIDERS))('%s implements every contract method', (name, ProviderClass) => {
    const instance = new ProviderClass({ secretKey: 'x', bankCode: '999' });
    expect(instance).toBeInstanceOf(PaymentsProvider);
    for (const method of CONTRACT_METHODS) {
      expect(typeof instance[method]).toBe('function');
    }
  });

  test('registry resolves "paystack" to a PaystackProvider', () => {
    const provider = getProvider('paystack', { secretKey: 'sk_test' });
    expect(provider).toBeInstanceOf(PaystackProvider);
  });

  test('registry resolves "self_issued_nuban" to a SelfIssuedNubanProvider', () => {
    const provider = getProvider('self_issued_nuban', { bankCode: '999' });
    expect(provider).toBeInstanceOf(SelfIssuedNubanProvider);
  });

  test('registry rejects an unknown provider name', () => {
    expect(() => getProvider('does_not_exist', {})).toThrow('Unknown provider');
  });

  const SYNC_METHODS = ['verifyWebhookSignature', 'parseWebhookEvent'];
  // provisionAccount is real now (NUBAN check-digit generation is public,
  // standardized math — see selfIssuedNuban.test.js) — everything else
  // still needs an actual switching partner's shape and stays a stub.
  const ASYNC_METHODS = CONTRACT_METHODS.filter((m) => !SYNC_METHODS.includes(m) && m !== 'provisionAccount');

  test.each(ASYNC_METHODS)(
    'SelfIssuedNubanProvider.%s rejects as not-implemented rather than silently no-op-ing',
    async (method) => {
      const provider = new SelfIssuedNubanProvider({ bankCode: '999' });
      await expect(provider[method]({})).rejects.toThrow('does not implement');
    }
  );

  test.each(SYNC_METHODS)(
    'SelfIssuedNubanProvider.%s throws not-implemented synchronously',
    (method) => {
      const provider = new SelfIssuedNubanProvider({ bankCode: '999' });
      expect(() => provider[method]('{}', 'sig')).toThrow('does not implement');
    }
  );
});
