const { NoopEmailProvider } = require('./noopEmailProvider');
const { SmtpEmailProvider } = require('./smtpEmailProvider');
const config = require('../config');

// A single deploy-time choice (config.email.provider), not a per-request
// lookup — same reasoning as trustpay-backend's own identity/registry.js
// (IDENTITY_PROVIDER): email delivery is a platform-operational concern
// here, not something a tenant configures the way a payment rail is.
let cached;
function getEmailProvider() {
  if (cached) return cached;
  if (config.email.provider === 'smtp') {
    cached = new SmtpEmailProvider(config.email.smtp);
  } else {
    cached = new NoopEmailProvider();
  }
  return cached;
}

module.exports = { getEmailProvider };
