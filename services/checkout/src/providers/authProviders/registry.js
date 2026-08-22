const { AuthCoreProvider } = require('./authCoreProvider');
const { FirebaseAuthProvider } = require('./firebaseAuthProvider');
const { NoopAuthProvider } = require('./noopAuthProvider');
const { InvalidProviderError } = require('../../utils/errors');

// Adding a real provider beyond AuthCore is a new provider file plus one
// entry here — nothing else in this service changes, same guarantee
// services/payments' own registry.js already proved with two structurally
// different rails, and this service's own checkout-provider registry
// already proves with Paystack.
const AUTH_PROVIDERS = {
  authcore: AuthCoreProvider,
  firebase: FirebaseAuthProvider,
  noop: NoopAuthProvider,
};

/**
 * Resolves the configured auth provider — a single, service-wide deploy-
 * time choice (config.authProvider.name), not a per-tenant lookup: AuthCore
 * stays one shared account across every tenant's merchants (see
 * config/index.js's own comment on this), tenant isolation is enforced by
 * always resolving a Merchant via {tenantId, email}, never by email alone.
 */
function getAuthProvider(providerName, providerConfig) {
  const ProviderClass = AUTH_PROVIDERS[providerName];
  if (!ProviderClass) {
    throw new InvalidProviderError(providerName);
  }
  return new ProviderClass(providerConfig);
}

module.exports = { getAuthProvider, AUTH_PROVIDERS };
