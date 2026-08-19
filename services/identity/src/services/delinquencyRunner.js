// Same "process-internal periodic job" shape as services/payments'
// reconciliationRunner.js — started alongside the HTTP server, not a
// separate deployable process. Each tick: for every tenant this service
// holds both a Ledger and a Compliance credential for, ask the Ledger
// which loans are ACTIVE and past due (it already computed daysPastDue/
// bucket — see internal/loan.DaysPastDue), then forward that fact to
// Compliance so a staff member sees it through the existing, already-
// shipped COMPLIANCE_CASE_REVIEW flow. Neither call is maker-checker —
// mechanical, caller-fed, same tier as LOAN_ELIGIBILITY_CHECK.
const prisma = require('../db/prismaClient');
const backendExecutor = require('./backendExecutor');
const config = require('../config');
const logger = require('../utils/logger');

async function tenantsWithBothCredentials() {
  const rows = await prisma.tenantBackendCredential.findMany({
    where: { service: { in: ['ledger', 'compliance'] } },
    select: { tenantId: true, service: true },
  });
  const byTenant = new Map();
  for (const row of rows) {
    if (!byTenant.has(row.tenantId)) byTenant.set(row.tenantId, new Set());
    byTenant.get(row.tenantId).add(row.service);
  }
  return [...byTenant.entries()]
    .filter(([, services]) => services.has('ledger') && services.has('compliance'))
    .map(([tenantId]) => tenantId);
}

async function runOnce() {
  const tenantIds = await tenantsWithBothCredentials();
  for (const tenantId of tenantIds) {
    try {
      await flagTenant(tenantId);
    } catch (err) {
      logger.error(`[DelinquencyRunner] tenant ${tenantId} failed: ${err.message}`);
    }
  }
}

async function flagTenant(tenantId) {
  const { loans } = await backendExecutor.execute('LOAN_LIST_ACTIVE', tenantId, {});
  const overdue = (loans || []).filter((loan) => loan.daysPastDue > 0);

  for (const loan of overdue) {
    try {
      await backendExecutor.execute('LOAN_DELINQUENCY_FLAG', tenantId, {
        userId: loan.externalCustomerId,
        loanAccountId: loan.id,
        daysPastDue: loan.daysPastDue,
        bucket: loan.bucket,
        principalOutstandingKobo: loan.balance,
      });
    } catch (err) {
      logger.error(`[DelinquencyRunner] tenant ${tenantId} loan ${loan.id} flag failed: ${err.message}`);
    }
  }

  if (overdue.length > 0) {
    logger.info(`[DelinquencyRunner] tenant ${tenantId}: ${overdue.length} overdue loan(s) flagged`);
  }
}

function start() {
  const intervalMs = config.delinquency.pollIntervalMinutes * 60_000;
  const timer = setInterval(async () => {
    try {
      await runOnce();
    } catch (err) {
      logger.error(`[DelinquencyRunner] tick failed: ${err.message}`);
    }
  }, intervalMs);
  logger.info(`Delinquency runner started, polling every ${config.delinquency.pollIntervalMinutes}m`);
  return timer;
}

module.exports = { start, runOnce };
