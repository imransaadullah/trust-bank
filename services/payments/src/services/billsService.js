// The bills equivalent of settlementService.js's initiatePayout/
// reverseAndFail — deliberately a parallel implementation, not a shared
// import. See BillPaymentAttempt's comment in schema.prisma: reusing
// SettlementAttempt (and settlementService's private reverseAndFail,
// which is typed against it) would pull in a real foreign key to
// TenantProviderConfig, forcing any bills-only tenant to also configure
// a payment rail just to pay a bill.
const prisma = require('../db/prismaClient');
const billsConfigService = require('./billsConfigService');
const ledgerClient = require('./ledgerClient');
const logger = require('../utils/logger');

async function getBillers(tenantId, type) {
  const { provider } = await billsConfigService.getProviderForTenant(tenantId);
  return provider.getBillers(type);
}

async function verifyBillCustomer(tenantId, { billerCode, customerId }) {
  const { provider } = await billsConfigService.getProviderForTenant(tenantId);
  return provider.verifyBillCustomer(billerCode, customerId);
}

async function purchaseBill(tenantId, input) {
  const { provider } = await billsConfigService.getProviderForTenant(tenantId);

  const existing = await findAttempt(tenantId, provider.name, input.reference);
  if (existing) {
    return existing;
  }

  const attempt = await prisma.billPaymentAttempt.create({
    data: {
      tenantId, provider: provider.name, providerRef: input.reference,
      externalCustomerId: input.externalCustomerId, billerCode: input.billerCode,
      customerId: input.customerId, amount: input.amount, status: 'pending',
      journalEntryId: input.debitJournalEntryId,
    },
  });

  let result;
  try {
    result = await provider.purchaseBill({
      billerCode: input.billerCode, customerId: input.customerId, amount: input.amount,
      planCode: input.planCode, trackingReference: input.reference,
      customerName: input.customerName, phone: input.phone,
    });
  } catch (err) {
    await reverseAndFail(tenantId, attempt, err.message);
    throw err;
  }

  if (result.success && result.status === 'completed') {
    await prisma.billPaymentAttempt.update({
      where: { id: attempt.id }, data: { status: 'resolved', resolvedAt: new Date() },
    });
  } else if (result.success && result.status === 'processing') {
    // Accepted, not confirmed — stays 'pending' (already its state);
    // reconciliation resolves it once checkPurchaseStatus confirms.
  } else {
    await reverseAndFail(tenantId, attempt, result.message || 'Provider bill payment failed');
  }

  return prisma.billPaymentAttempt.findUnique({ where: { id: attempt.id } });
}

async function reverseAndFail(tenantId, attempt, reason) {
  if (attempt.journalEntryId) {
    try {
      await ledgerClient.reverseJournalEntry(tenantId, attempt.journalEntryId, {
        reason, idempotencyKey: `${tenantId}:bill-reverse:${attempt.providerRef}`,
      });
    } catch (err) {
      logger.error(`[Bills] Failed to reverse journal entry ${attempt.journalEntryId}: ${err.message}`);
    }
  }
  await prisma.billPaymentAttempt.update({
    where: { id: attempt.id }, data: { status: 'failed', failureReason: reason, resolvedAt: new Date() },
  });
}

// Mirrors settlementService.js's applyOutboundOutcome/reconcileOutboundAttempt/
// autoRefundStaleAttempt trio exactly — the bills side of the same pattern,
// against BillPaymentAttempt instead of SettlementAttempt.
async function applyBillOutcome(tenantId, attempt, outcome) {
  if (outcome.status === 'completed') {
    await prisma.billPaymentAttempt.update({
      where: { id: attempt.id }, data: { status: 'resolved', resolvedAt: new Date() },
    });
    return { action: 'resolved' };
  }
  if (outcome.status === 'failed') {
    await reverseAndFail(tenantId, attempt, outcome.failureReason || 'Provider confirmed bill payment failure');
    return { action: 'reversed' };
  }
  return { action: 'still-pending' };
}

// Polls the provider directly via checkPurchaseStatus — the mechanism
// that actually resolves a 'processing' purchase now, not just a
// crash-recovery backstop. See billsProvider.js's BillPurchaseResult doc.
async function reconcileBillAttempt(attempt) {
  const { provider } = await billsConfigService.getProviderForTenant(attempt.tenantId);
  let outcome;
  try {
    outcome = await provider.checkPurchaseStatus(attempt.providerRef);
  } catch (err) {
    logger.error(`[Bills] checkPurchaseStatus failed for attempt ${attempt.id}: ${err.message}`);
    return { action: 'skipped', reason: err.message };
  }
  return applyBillOutcome(attempt.tenantId, attempt, outcome);
}

// The auto-refund SLA made real for bills too: an attempt still
// unresolved past the configured window gets reversed regardless of
// what the provider says (or doesn't say).
async function autoRefundStaleBillAttempt(attempt, reason) {
  await reverseAndFail(attempt.tenantId, attempt, reason);
  return { action: 'auto-refunded' };
}

function findAttempt(tenantId, provider, providerRef) {
  return prisma.billPaymentAttempt.findUnique({
    where: { tenantId_provider_providerRef: { tenantId, provider, providerRef } },
  });
}

module.exports = {
  getBillers, verifyBillCustomer, purchaseBill,
  reconcileBillAttempt, autoRefundStaleBillAttempt,
};
