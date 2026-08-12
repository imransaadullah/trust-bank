const { KudaBillsProvider } = require('./kudaBillsProvider');
const { VtpassBillsProvider } = require('./vtpassBillsProvider');
const { InvalidProviderError } = require('../utils/errors');

const BILLS_PROVIDERS = {
  kuda: KudaBillsProvider,
  vtpass: VtpassBillsProvider,
};

/** Instantiate the right bills provider for a tenant, given its decrypted credentials. */
function getBillsProvider(providerName, credentials) {
  const ProviderClass = BILLS_PROVIDERS[providerName];
  if (!ProviderClass) {
    throw new InvalidProviderError(providerName);
  }
  return new ProviderClass(credentials);
}

module.exports = { getBillsProvider, BILLS_PROVIDERS };
