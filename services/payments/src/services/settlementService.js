// Orchestrates both directions of settlement: resolving an inbound
// provider webhook into a Ledger deposit, and initiating + reconciling
// an outbound payout (including reversing the Ledger debit if the
// provider ultimately fails it). This is the one place that ties
// providers/, accountProvisioningService, and ledgerClient together —
// routes stay thin, providers stay rail-specific, this stays the
// settlement logic.
const prisma = require('../db/prismaClient');
const tenantConfigService = require('./tenantConfigService');
const accountProvisioningService = require('./accountProvisioningService');
const ledgerClient = require('./ledgerClient');
const logger = require('../utils/logger');
const { WebhookVerificationError, InvalidProviderError } = require('../utils/errors');

async function resolveInboundWebhook(tenantSlug, providerName, rawBody, signature) {
  const { tenantId, provider } = await tenantConfigService.getProviderForTenantSlug(tenantSlug);
  if (provider.name !== providerName) {
    throw new InvalidProviderError(providerName);
  }
  if (!provider.verifyWebhookSignature(rawBody, signature)) {
    throw new WebhookVerificationError();
  }

  const eventBody = JSON.parse(rawBody.toString('utf8'));
  const event = provider.parseWebhookEvent(eventBody);

  if (event.type === 'deposit') {
    return handleInboundDeposit(tenantId, provider.name, event);
  }
  if (event.type === 'withdrawal_success' || event.type === 'withdrawal_failed') {
    return handleOutboundOutcome(tenantId, provider.name, event);
  }
  return { handled: false, reason: `unhandled event type: ${event.type}` };
}

async function handleInboundDeposit(tenantId, providerName, event) {
  let attempt = await findAttempt(tenantId, providerName, event.providerRef);

  if (attempt?.status === 'resolved') {
    return { handled: true, alreadyProcessed: true, journalEntryId: attempt.journalEntryId };
  }

  if (!attempt) {
    const account = await accountProvisioningService.findByAccountNumber(tenantId, event.accountNumber);
    attempt = await prisma.settlementAttempt.create({
      data: {
        tenantId, direction: 'inbound', provider: providerName, providerRef: event.providerRef,
        externalCustomerId: account?.externalCustomerId || null, amount: event.amount,
        status: 'pending', rawPayload: event.raw,
      },
    });
    if (!account) {
      await markFailed(attempt.id, 'no provisioned account for this account number');
      logger.error(`[Settlement] Unmapped account ${event.accountNumber} for tenant ${tenantId}`);
      return { handled: false, reason: 'unmapped account number' };
    }
  }

  if (!attempt.externalCustomerId) {
    return { handled: false, reason: 'unmapped account number' };
  }

  const idempotencyKey = `${tenantId}:${providerName}:${event.providerRef}`;
  const entry = await ledgerClient.confirmDeposit(tenantId, {
    externalCustomerId: attempt.externalCustomerId, amount: event.amount, providerRef: event.providerRef,
    reference: event.providerRef, idempotencyKey, description: `Deposit via ${providerName}`,
  });

  await prisma.settlementAttempt.update({
    where: { id: attempt.id },
    data: { status: 'resolved', journalEntryId: entry.id, resolvedAt: new Date() },
  });

  return { handled: true, journalEntryId: entry.id };
}

async function initiatePayout(tenantId, input) {
  const { provider } = await tenantConfigService.getProviderForTenant(tenantId);

  const existing = await findAttempt(tenantId, provider.name, input.reference);
  if (existing) {
    return existing;
  }

  const attempt = await prisma.settlementAttempt.create({
    data: {
      tenantId, direction: 'outbound', provider: provider.name, providerRef: input.reference,
      externalCustomerId: input.externalCustomerId, amount: input.amount,
      status: 'pending', journalEntryId: input.debitJournalEntryId,
    },
  });

  let result;
  try {
    result = await provider.initiateOutbound({
      amount: input.amount, beneficiaryAccountNumber: input.beneficiaryAccountNumber,
      beneficiaryBankCode: input.beneficiaryBankCode, beneficiaryName: input.beneficiaryName,
      reference: input.reference, description: input.description,
    });
  } catch (err) {
    await reverseAndFail(tenantId, attempt, err.message);
    throw err;
  }

  if (result.status === 'completed') {
    await prisma.settlementAttempt.update({
      where: { id: attempt.id }, data: { status: 'resolved', resolvedAt: new Date() },
    });
  }
  // status === 'processing' stays pending — resolved later by the transfer.success/
  // transfer.failed webhook via handleOutboundOutcome.

  return prisma.settlementAttempt.findUnique({ where: { id: attempt.id } });
}

async function handleOutboundOutcome(tenantId, providerName, event) {
  const attempt = await findAttempt(tenantId, providerName, event.providerRef);
  if (!attempt || attempt.direction !== 'outbound') {
    return { handled: false, reason: 'no matching outbound attempt' };
  }
  if (attempt.status !== 'pending') {
    return { handled: true, alreadyProcessed: true };
  }

  if (event.type === 'withdrawal_success') {
    await prisma.settlementAttempt.update({
      where: { id: attempt.id }, data: { status: 'resolved', resolvedAt: new Date() },
    });
    return { handled: true };
  }

  await reverseAndFail(tenantId, attempt, event.failureReason || 'Provider payout failed');
  return { handled: true, reversed: true };
}

async function reverseAndFail(tenantId, attempt, reason) {
  if (attempt.journalEntryId) {
    try {
      await ledgerClient.reverseJournalEntry(tenantId, attempt.journalEntryId, {
        reason, idempotencyKey: `${tenantId}:reverse:${attempt.providerRef}`,
      });
    } catch (err) {
      logger.error(`[Settlement] Failed to reverse journal entry ${attempt.journalEntryId}: ${err.message}`);
    }
  }
  await markFailed(attempt.id, reason);
}

function findAttempt(tenantId, provider, providerRef) {
  return prisma.settlementAttempt.findUnique({
    where: { tenantId_provider_providerRef: { tenantId, provider, providerRef } },
  });
}

function markFailed(attemptId, reason) {
  return prisma.settlementAttempt.update({
    where: { id: attemptId }, data: { status: 'failed', failureReason: reason, resolvedAt: new Date() },
  });
}

module.exports = { resolveInboundWebhook, initiatePayout };
