// Same "process-internal periodic job" shape as delinquencyRunner.js and
// services/payments' reconciliationRunner.js. Each tick: for every tenant
// this service holds both a Ledger and a Compliance credential for, list
// its ACTIVE loans (reusing LOAN_LIST_ACTIVE unchanged) and submit each
// one's performance data to the configured credit bureau provider —
// currently always the no-op stub (see providers/noopCreditBureauProvider.js),
// since no real CRC/FirstCentral relationship exists yet. Not
// maker-checker — mechanical, scheduled, no staff discretion, same tier
// as delinquencyRunner's own calls.
const backendExecutor = require('./backendExecutor');
const tenantBackendCredentialService = require('./tenantBackendCredentialService');
const { NoopCreditBureauProvider } = require('../providers/noopCreditBureauProvider');
const config = require('../config');
const logger = require('../utils/logger');

const provider = new NoopCreditBureauProvider();

async function runOnce() {
  const tenantIds = await tenantBackendCredentialService.listTenantsWithLedgerAndCompliance();
  for (const tenantId of tenantIds) {
    try {
      await submitTenant(tenantId);
    } catch (err) {
      logger.error(`[CreditBureauRunner] tenant ${tenantId} failed: ${err.message}`);
    }
  }
}

async function submitTenant(tenantId) {
  const { loans } = await backendExecutor.execute('LOAN_LIST_ACTIVE', tenantId, {});

  for (const loan of loans || []) {
    try {
      await provider.submitLoanRecord({
        tenantId, externalCustomerId: loan.externalCustomerId, loanAccountId: loan.id,
        principalKobo: loan.principalKobo, annualRateBps: loan.annualRateBps,
        maturityDate: loan.maturityDate, balance: loan.balance,
        daysPastDue: loan.daysPastDue, bucket: loan.bucket, status: loan.status,
        // Verified name/BVN a real submission needs — see
        // providers/creditBureauProvider.js's own comment on why this
        // platform has nowhere generic to source it from yet.
        customerIdentity: null,
      });
    } catch (err) {
      logger.error(`[CreditBureauRunner] tenant ${tenantId} loan ${loan.id} submission failed: ${err.message}`);
    }
  }

  if ((loans || []).length > 0) {
    logger.info(`[CreditBureauRunner] tenant ${tenantId}: ${loans.length} loan(s) submitted`);
  }
}

function start() {
  const intervalMs = config.creditBureau.pollIntervalMinutes * 60_000;
  const timer = setInterval(async () => {
    try {
      await runOnce();
    } catch (err) {
      logger.error(`[CreditBureauRunner] tick failed: ${err.message}`);
    }
  }, intervalMs);
  logger.info(`Credit bureau runner started, polling every ${config.creditBureau.pollIntervalMinutes}m`);
  return timer;
}

module.exports = { start, runOnce };
