const { NoopCardIssuingProvider } = require('./noopCardIssuingProvider');
const { InvalidProviderError } = require('../utils/errors');

// 'noop' is the only entry until a real card-issuing-as-a-service
// relationship exists (Sudo Africa or otherwise). Adding one is a new
// provider file plus one entry here — nothing else in this service
// changes, same guarantee services/payments' own registry.js already
// proved with two structurally different rails.
const PROVIDERS = {
  noop: NoopCardIssuingProvider,
};

/** Instantiate the right provider for a tenant, given its decrypted credentials. */
function getProvider(providerName, credentials) {
  const ProviderClass = PROVIDERS[providerName];
  if (!ProviderClass) {
    throw new InvalidProviderError(providerName);
  }
  return new ProviderClass(credentials);
}

module.exports = { getProvider, PROVIDERS };
