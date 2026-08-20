const { EmailProvider } = require('./emailProvider');
const logger = require('../utils/logger');

// The default until EMAIL_PROVIDER=smtp is configured with real
// credentials. Logs the raw reset token instead of sending anything —
// this environment's own live verification runs against this.
class NoopEmailProvider extends EmailProvider {
  constructor() {
    super('noop');
  }

  async sendPasswordResetEmail({ to, resetToken, expiresInMinutes }) {
    logger.info(`[NoopEmailProvider] would email password reset token to ${to} (expires in ${expiresInMinutes}m): ${resetToken}`);
    return { sent: true };
  }
}

module.exports = { NoopEmailProvider };
