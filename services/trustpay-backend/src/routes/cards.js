const express = require('express');
const prisma = require('../db/prismaClient');
const cardsClient = require('../services/cardsClient');
const complianceClient = require('../services/complianceClient');
const { requireAuth } = require('../middleware/auth');
const { UserNotFoundError, ComplianceDeniedError, CardNotFoundError } = require('../utils/errors');

const router = express.Router();

async function loadUserOrThrow(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UserNotFoundError();
  return user;
}

// Issuance is routine self-service, gated on a policy check (min KYC
// tier, max cards), not a staff decision — same posture as opening a
// savings account. Runs the eligibility check itself and calls Cards
// directly; Cards never calls Compliance on its own (same "the calling
// backend checks first" rule every domain in this platform holds).
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const user = await loadUserOrThrow(req.userId);
    const existingCards = await cardsClient.listCards(user.id);
    const existingCardCount = existingCards.filter((c) => c.status !== 'CLOSED').length;

    const decision = await complianceClient.checkCardIssuance({
      userId: user.id, kycTier: user.kycTier, existingCardCount,
    });
    if (!decision.allowed) throw new ComplianceDeniedError(decision.reason);

    const card = await cardsClient.issueCard({
      externalCustomerId: user.id,
      dailySpendLimitKobo: decision.dailySpendLimitKobo,
      singleTxnLimitKobo: decision.singleTxnLimitKobo,
    });
    res.status(201).json({ success: true, data: card });
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const user = await loadUserOrThrow(req.userId);
    const cards = await cardsClient.listCards(user.id);
    res.json({ success: true, data: cards });
  } catch (err) {
    next(err);
  }
});

async function ownCardOrThrow(userId, cardId) {
  const cards = await cardsClient.listCards(userId);
  if (!cards.some((c) => c.id === cardId)) throw new CardNotFoundError();
}

router.post('/:id/freeze', requireAuth, async (req, res, next) => {
  try {
    const user = await loadUserOrThrow(req.userId);
    await ownCardOrThrow(user.id, req.params.id);
    const card = await cardsClient.freezeCard(req.params.id);
    res.json({ success: true, data: card });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/unfreeze', requireAuth, async (req, res, next) => {
  try {
    const user = await loadUserOrThrow(req.userId);
    await ownCardOrThrow(user.id, req.params.id);
    const card = await cardsClient.unfreezeCard(req.params.id);
    res.json({ success: true, data: card });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/close', requireAuth, async (req, res, next) => {
  try {
    const user = await loadUserOrThrow(req.userId);
    await ownCardOrThrow(user.id, req.params.id);
    const card = await cardsClient.closeCard(req.params.id);
    res.json({ success: true, data: card });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
