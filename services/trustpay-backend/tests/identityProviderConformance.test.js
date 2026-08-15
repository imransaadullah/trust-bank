// Proves the identity contract fits both a real provider (AuthCore) and a
// structurally different one (Twilio Verify) before a real second market
// needs it — same "stub, not skipped" discipline as services/payments'
// providerConformance.test.js / billsProviderConformance.test.js.
const { IdentityProvider } = require('../src/identity/identityProvider');
const { AuthCoreProvider } = require('../src/identity/authCoreProvider');
const { TwilioVerifyProvider } = require('../src/identity/twilioVerifyProvider');
const { getIdentityProvider, IDENTITY_PROVIDERS } = require('../src/identity/registry');

const CONTRACT_METHODS = ['sendOtp', 'verifyOtp'];

describe('identity provider contract conformance', () => {
  test.each(Object.entries(IDENTITY_PROVIDERS))('%s implements every contract method', (name, ProviderClass) => {
    const instance = new ProviderClass({
      baseUrl: 'https://x', projectKey: 'x', jwksUrl: 'https://x/jwks', projectId: 'x',
      accountSid: 'x', authToken: 'x', serviceSid: 'x',
    });
    expect(instance).toBeInstanceOf(IdentityProvider);
    for (const method of CONTRACT_METHODS) {
      expect(typeof instance[method]).toBe('function');
    }
  });

  test('registry resolves "authcore" to an AuthCoreProvider', () => {
    const provider = getIdentityProvider('authcore', { baseUrl: 'https://x', projectKey: 'x' });
    expect(provider).toBeInstanceOf(AuthCoreProvider);
  });

  test('registry resolves "twilio_verify" to a TwilioVerifyProvider', () => {
    const provider = getIdentityProvider('twilio_verify', { accountSid: 'x', authToken: 'x', serviceSid: 'x' });
    expect(provider).toBeInstanceOf(TwilioVerifyProvider);
  });

  test('registry rejects an unknown provider name', () => {
    expect(() => getIdentityProvider('does_not_exist', {})).toThrow('Unknown identity provider');
  });

  test.each(CONTRACT_METHODS)(
    'TwilioVerifyProvider.%s rejects as not-implemented rather than silently no-op-ing',
    async (method) => {
      const provider = new TwilioVerifyProvider({ accountSid: 'x', authToken: 'x', serviceSid: 'x' });
      await expect(provider[method]('+2348000000000', 'x')).rejects.toThrow('does not implement');
    },
  );
});
