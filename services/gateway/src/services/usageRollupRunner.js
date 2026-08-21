// Same "one process, one systemd unit" background-interval pattern as
// services/payments' reconciliationRunner.js — this is Gateway's first.
const usageRollupService = require('./usageRollupService');
const config = require('../config');
const logger = require('../utils/logger');

function start() {
  const intervalMs = config.usageRollup.pollIntervalMinutes * 60_000;
  const timer = setInterval(async () => {
    try {
      const { upsertedRows, deletedRows } = await usageRollupService.rollupAndPrune();
      logger.info(`[UsageRollupRunner] rolled up ${upsertedRows} api_key_daily_usage row(s), pruned ${deletedRows} rate_limit_counters row(s)`);
    } catch (err) {
      logger.error(`[UsageRollupRunner] tick failed: ${err.message}`);
    }
  }, intervalMs);
  logger.info(`Usage rollup runner started, polling every ${config.usageRollup.pollIntervalMinutes}m`);
  return timer;
}

module.exports = { start };
