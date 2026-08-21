const { NoopCheckoutProvider } = require('./noopCheckoutProvider');
const { PaystackCheckoutProvider } = require('./paystackCheckoutProvider');
const { InvalidProviderError } = require('../utils/errors');

// Adding a real provider beyond Paystack (Flutterwave, Squad) is a new
// provider file plus one entry here — nothing else in this service
// changes, same guarantee services/payments' own registry.js already
// proved with two structurally different rails.
const PROVIDERS = {
  noop: NoopCheckoutProvider,
  paystack: PaystackCheckoutProvider,
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
