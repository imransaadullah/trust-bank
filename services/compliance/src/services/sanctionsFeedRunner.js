// Same "one process, one systemd unit" background-interval pattern as
// services/payments' reconciliationRunner.js — started alongside the HTTP
// server, not a separate deployable process. Daily, not minutes — a
// sanctions list doesn't need minute-level freshness the way a stuck
// payout does.
const { ingestAllFeeds } = require('./sanctionsFeedService');
const config = require('../config');
const logger = require('../utils/logger');

function start() {
  const intervalMs = config.sanctionsFeed.pollIntervalHours * 3_600_000;
  const timer = setInterval(async () => {
    try {
      await ingestAllFeeds();
    } catch (err) {
      logger.error(`[SanctionsFeedRunner] tick failed: ${err.message}`);
    }
  }, intervalMs);
  logger.info(`Sanctions feed runner started, polling every ${config.sanctionsFeed.pollIntervalHours}h`);
  return timer;
}

module.exports = { start };
