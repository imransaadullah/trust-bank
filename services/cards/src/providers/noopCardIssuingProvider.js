const { randomUUID } = require('crypto');
const { CardIssuingProvider } = require('./cardIssuingProvider');
const logger = require('../utils/logger');

// The only provider until a real card-issuing-as-a-service relationship
// exists. providerRef and last4 are both obviously synthetic — a UUID
// prefixed noop_card_, and a last4 drawn from a fixed, clearly-fake
// range — deliberately not realistic-looking, so nothing here could ever
// be mistaken for real card data even by accident.
class NoopCardIssuingProvider extends CardIssuingProvider {
  constructor() {
    super('noop');
  }

  async issueCard(input) {
    const card = {
      providerRef: `noop_card_${randomUUID()}`,
      last4: '0000',
      expiryMonth: 1,
      expiryYear: new Date().getUTCFullYear() + 3,
    };
    logger.info(`[NoopCardIssuingProvider] would issue card: ${JSON.stringify({ ...input, ...card })}`);
    return card;
  }

  async freezeCard(providerRef) {
    logger.info(`[NoopCardIssuingProvider] would freeze card: ${providerRef}`);
    return { success: true };
  }

  async unfreezeCard(providerRef) {
    logger.info(`[NoopCardIssuingProvider] would unfreeze card: ${providerRef}`);
    return { success: true };
  }

  async closeCard(providerRef) {
    logger.info(`[NoopCardIssuingProvider] would close card: ${providerRef}`);
    return { success: true };
  }
}

module.exports = { NoopCardIssuingProvider };
