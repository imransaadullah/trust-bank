const { PaystackProvider } = require('./paystack');
const { SelfIssuedNubanProvider } = require('./selfIssuedNuban');
const { InvalidProviderError } = require('../utils/errors');

const PROVIDERS = {
  paystack: PaystackProvider,
  self_issued_nuban: SelfIssuedNubanProvider,
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
