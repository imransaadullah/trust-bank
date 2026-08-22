// Proves the auth-identifier-verification contract fits both a real
// provider (AuthCore) and a structurally different one (Firebase) before
// a real second market needs it — same "stub, not skipped" discipline as
// this service's own providerConformance-style tests and
// services/trustpay-backend's identityProviderConformance.test.js.
const { AuthProvider } = require('../src/providers/authProviders/authProvider');
const { AuthCoreProvider } = require('../src/providers/authProviders/authCoreProvider');
const { FirebaseAuthProvider } = require('../src/providers/authProviders/firebaseAuthProvider');
const { NoopAuthProvider, NOOP_CODE } = require('../src/providers/authProviders/noopAuthProvider');
const { getAuthProvider, AUTH_PROVIDERS } = require('../src/providers/authProviders/registry');

const CONTRACT_METHODS = ['sendOtp', 'verifyOtp'];

describe('auth provider contract conformance', () => {
  test.each(Object.entries(AUTH_PROVIDERS))('%s implements every contract method', (name, ProviderClass) => {
    const instance = new ProviderClass({
      baseUrl: 'https://x', projectKey: 'x', jwksUrl: 'https://x/jwks', projectId: 'x',
      serviceAccountKey: 'x',
    });
    expect(instance).toBeInstanceOf(AuthProvider);
    for (const method of CONTRACT_METHODS) {
      expect(typeof instance[method]).toBe('function');
    }
  });

  test('registry resolves "authcore" to an AuthCoreProvider', () => {
    const provider = getAuthProvider('authcore', { baseUrl: 'https://x', projectKey: 'x' });
    expect(provider).toBeInstanceOf(AuthCoreProvider);
  });

  test('registry resolves "firebase" to a FirebaseAuthProvider', () => {
    const provider = getAuthProvider('firebase', { projectId: 'x', serviceAccountKey: 'x' });
    expect(provider).toBeInstanceOf(FirebaseAuthProvider);
  });

  test('registry resolves "noop" to a NoopAuthProvider', () => {
    const provider = getAuthProvider('noop', {});
    expect(provider).toBeInstanceOf(NoopAuthProvider);
  });

  test('registry rejects an unknown provider name', () => {
    expect(() => getAuthProvider('does_not_exist', {})).toThrow('Unknown checkout provider');
  });

  test.each(CONTRACT_METHODS)(
    'FirebaseAuthProvider.%s rejects as not-implemented rather than silently no-op-ing',
    async (method) => {
      const provider = new FirebaseAuthProvider({ projectId: 'x', serviceAccountKey: 'x' });
      await expect(provider[method]('merchant@example.com', 'x')).rejects.toThrow('does not implement');
    },
  );

  describe('NoopAuthProvider', () => {
    const provider = new NoopAuthProvider();

    test('verifies only the documented fixed code, not any code', async () => {
      const good = await provider.verifyOtp('merchant@example.com', NOOP_CODE);
      expect(good).toEqual({ verified: true, email: 'merchant@example.com', providerUid: 'noop_merchant@example.com' });

      const bad = await provider.verifyOtp('merchant@example.com', '111111');
      expect(bad.verified).toBe(false);
    });
  });
});
