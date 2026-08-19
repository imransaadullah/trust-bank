const { CreditBureauProvider } = require('./creditBureauProvider');
const logger = require('../utils/logger');

// The only provider until a real CRC/FirstCentral relationship exists.
// Logs exactly what a real submission would send rather than actually
// sending anything — enough to verify creditBureauRunner.js live without
// real bureau credentials.
class NoopCreditBureauProvider extends CreditBureauProvider {
  constructor() {
    super('noop');
  }

  async submitLoanRecord(record) {
    logger.info(`[NoopCreditBureauProvider] would submit loan record: ${JSON.stringify(record)}`);
    return { submitted: true, providerRef: null };
  }
}

module.exports = { NoopCreditBureauProvider };
