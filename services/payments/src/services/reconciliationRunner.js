// Same "one process, one systemd unit" pattern as the Ledger's outbox
// goroutine (services/ledger/cmd/ledger/main.go) — a background interval
// started alongside the HTTP server, not a separate deployable process.
const reconciliationService = require('./reconciliationService');
const config = require('../config');
const logger = require('../utils/logger');

function start() {
  const intervalMs = config.reconciliation.pollIntervalMinutes * 60_000;
  const timer = setInterval(async () => {
    try {
      await reconciliationService.reconcileAllTenants();
    } catch (err) {
      logger.error(`[ReconciliationRunner] tick failed: ${err.message}`);
    }
  }, intervalMs);
  logger.info(`Reconciliation runner started, polling every ${config.reconciliation.pollIntervalMinutes}m`);
  return timer;
}

module.exports = { start };
