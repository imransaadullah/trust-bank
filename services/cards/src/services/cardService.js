// Card lifecycle + the two money-adjacent operations (authorize, settle).
// The eligibility decision (min KYC tier, limits) is made by the caller
// (trustpay-backend, via services/compliance) before issueCard is ever
// called — same "Compliance is consulted before the domain service
// writes, by the calling backend" rule every other domain in this
// platform already holds. This service never calls Compliance itself.
const prisma = require('../db/prismaClient');
const ledgerClient = require('./ledgerClient');
const { NoopCardIssuingProvider } = require('../providers/noopCardIssuingProvider');
const { CardNotFoundError, CardNotActiveError } = require('../utils/errors');

const provider = new NoopCardIssuingProvider();

async function getCardOrThrow(tenantId, cardId) {
  const card = await prisma.card.findFirst({ where: { id: cardId, tenantId } });
  if (!card) throw new CardNotFoundError(cardId);
  return card;
}

async function issueCard({ tenantId, externalCustomerId, dailySpendLimitKobo, singleTxnLimitKobo }) {
  const issued = await provider.issueCard({ externalCustomerId });
  return prisma.card.create({
    data: {
      tenantId, externalCustomerId, status: 'ACTIVE',
      last4: issued.last4, expiryMonth: issued.expiryMonth, expiryYear: issued.expiryYear,
      providerRef: issued.providerRef, dailySpendLimitKobo, singleTxnLimitKobo,
    },
  });
}

async function listCardsByCustomer({ tenantId, externalCustomerId }) {
  return prisma.card.findMany({ where: { tenantId, externalCustomerId }, orderBy: { createdAt: 'desc' } });
}

async function freezeCard({ tenantId, cardId }) {
  const card = await getCardOrThrow(tenantId, cardId);
  if (card.status === 'CLOSED') throw new CardNotActiveError(cardId, card.status);
  await provider.freezeCard(card.providerRef);
  return prisma.card.update({ where: { id: card.id }, data: { status: 'FROZEN' } });
}

async function unfreezeCard({ tenantId, cardId }) {
  const card = await getCardOrThrow(tenantId, cardId);
  if (card.status !== 'FROZEN') throw new CardNotActiveError(cardId, card.status);
  await provider.unfreezeCard(card.providerRef);
  return prisma.card.update({ where: { id: card.id }, data: { status: 'ACTIVE' } });
}

async function closeCard({ tenantId, cardId }) {
  const card = await getCardOrThrow(tenantId, cardId);
  if (card.status === 'CLOSED') throw new CardNotActiveError(cardId, card.status);
  await provider.closeCard(card.providerRef);
  return prisma.card.update({ where: { id: card.id }, data: { status: 'CLOSED' } });
}

async function sumSettledToday(cardId) {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const result = await prisma.cardSettlement.aggregate({
    where: { cardId, createdAt: { gte: startOfToday } },
    _sum: { amountKobo: true },
  });
  return result._sum.amountKobo || 0;
}

// A decision object, not an exception, for every business-rule reject —
// same posture as services/compliance's decisionService (an
// authorization decline is a normal, expected outcome, not an error).
// Only a genuinely missing card throws.
async function authorize({ tenantId, cardId, amountKobo }) {
  const card = await getCardOrThrow(tenantId, cardId);

  if (card.status !== 'ACTIVE') {
    return { approved: false, reason: `Card is ${card.status}, not ACTIVE` };
  }
  if (amountKobo > card.singleTxnLimitKobo) {
    return { approved: false, reason: `Exceeds single-transaction limit of ${card.singleTxnLimitKobo} kobo` };
  }

  const spentToday = await sumSettledToday(card.id);
  if (spentToday + amountKobo > card.dailySpendLimitKobo) {
    return { approved: false, reason: `Exceeds daily spend limit of ${card.dailySpendLimitKobo} kobo` };
  }

  const account = await ledgerClient.getAccountByCustomer(tenantId, card.externalCustomerId);
  const balance = await ledgerClient.getBalance(tenantId, account.id);
  if (balance.amount < amountKobo) {
    return { approved: false, reason: 'Insufficient wallet balance' };
  }

  return { approved: true };
}

// Re-runs authorize's own checks rather than trusting a prior authorize
// call blindly — no hold/capture linkage exists in this slice (named,
// out of scope), so this is the guard against a card being frozen or a
// concurrent transaction consuming the daily limit between authorize and
// settle.
async function settle({ tenantId, cardId, amountKobo, reference, idempotencyKey, description }) {
  const decision = await authorize({ tenantId, cardId, amountKobo });
  if (!decision.approved) {
    return { settled: false, reason: decision.reason };
  }

  const card = await getCardOrThrow(tenantId, cardId);
  const entry = await ledgerClient.recordCardSettlement(tenantId, {
    externalCustomerId: card.externalCustomerId, amount: amountKobo,
    reference, idempotencyKey, description,
  });

  // Idempotent on retry — the Ledger's own call above already is (same
  // idempotencyKey returns the original entry, no error), this local
  // record needs the same guarantee.
  await prisma.cardSettlement.upsert({
    where: { idempotencyKey },
    create: { tenantId, cardId, amountKobo, reference, idempotencyKey },
    update: {},
  });

  return { settled: true, journalEntry: entry };
}

module.exports = { issueCard, listCardsByCustomer, freezeCard, unfreezeCard, closeCard, authorize, settle };
