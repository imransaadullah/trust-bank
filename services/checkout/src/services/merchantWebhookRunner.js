// Same setInterval + try/catch shell as services/gateway's own
// usageRollupRunner.js.
const merchantWebhookRunnerService = require('./merchantWebhookRunnerService');
const config = require('../config');
const logger = require('../utils/logger');

function start() {
  const intervalMs = config.merchantWebhook.pollIntervalSeconds * 1000;
  const timer = setInterval(async () => {
    try {
      const count = await merchantWebhookRunnerService.drainOnce();
      if (count > 0) {
        logger.info(`[MerchantWebhookRunner] processed ${count} deliverie(s)`);
      }
    } catch (err) {
      logger.error(`[MerchantWebhookRunner] tick failed: ${err.message}`);
    }
  }, intervalMs);
  logger.info(`Merchant webhook runner started, polling every ${config.merchantWebhook.pollIntervalSeconds}s`);
  return timer;
}

module.exports = { start };
