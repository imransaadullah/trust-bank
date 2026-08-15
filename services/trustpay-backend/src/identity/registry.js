const { AuthCoreProvider } = require('./authCoreProvider');
const { TwilioVerifyProvider } = require('./twilioVerifyProvider');
const { InvalidProviderError } = require('../utils/errors');

const IDENTITY_PROVIDERS = {
  authcore: AuthCoreProvider,
  twilio_verify: TwilioVerifyProvider,
};

/**
 * Resolves the configured identity provider — a single deploy-time
 * choice (config.identityProvider), not a per-request lookup, since this
 * backend is already single-tenant-per-deployment (config.tenantId is
 * one value too, never looked up per request).
 */
function getIdentityProvider(providerName, providerConfig) {
  const ProviderClass = IDENTITY_PROVIDERS[providerName];
  if (!ProviderClass) {
    throw new InvalidProviderError(providerName);
  }
  return new ProviderClass(providerConfig);
}

module.exports = { getIdentityProvider, IDENTITY_PROVIDERS };
