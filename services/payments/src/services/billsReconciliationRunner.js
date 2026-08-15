// Same "one process, one systemd unit" pattern as reconciliationRunner.js
// and the Ledger's outbox/accrual goroutines — a background interval
// started alongside the HTTP server, not a separate deployable process.
const billsReconciliationService = require('./billsReconciliationService');
const config = require('../config');
const logger = require('../utils/logger');

function start() {
  const intervalMs = config.billsReconciliation.pollIntervalMinutes * 60_000;
  const timer = setInterval(async () => {
    try {
      await billsReconciliationService.reconcileAllTenantsBills();
    } catch (err) {
      logger.error(`[BillsReconciliationRunner] tick failed: ${err.message}`);
    }
  }, intervalMs);
  logger.info(`Bills reconciliation runner started, polling every ${config.billsReconciliation.pollIntervalMinutes}m`);
  return timer;
}

module.exports = { start };
