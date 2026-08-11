const express = require('express');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../db/prismaClient');
const ledgerClient = require('../services/ledgerClient');
const { requireAuth } = require('../middleware/auth');
const { generateReference } = require('../utils/reference');
const { UserNotFoundError } = require('../utils/errors');

const router = express.Router();

async function loadUserOrThrow(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UserNotFoundError();
  return user;
}

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { annualRateBps, lockDays, principalKobo, description } = req.body;
    if (!principalKobo || principalKobo <= 0 || lockDays == null || annualRateBps == null) {
      return res.status(400).json({ success: false, error: 'annualRateBps, lockDays, and a positive principalKobo are required' });
    }

    const user = await loadUserOrThrow(req.userId);
    const reference = generateReference('SAV');
    const result = await ledgerClient.openSavingsAccount({
      externalCustomerId: user.id, annualRateBps, lockDays, principalKobo,
      reference, idempotencyKey: uuidv4(), description,
    });

    await prisma.transaction.create({
      data: {
        userId: user.id, type: 'savings_deposit', amount: principalKobo,
        journalEntryId: result.fundingEntry.id, description,
      },
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/withdraw', requireAuth, async (req, res, next) => {
  try {
    const { amount, description } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'a positive amount is required' });
    }

    const user = await loadUserOrThrow(req.userId);
    const reference = generateReference('SAVWD');
    const entry = await ledgerClient.withdrawSavings(req.params.id, {
      externalCustomerId: user.id, amount, reference, idempotencyKey: uuidv4(), description,
    });

    await prisma.transaction.create({
      data: {
        userId: user.id, type: 'savings_withdrawal', amount,
        journalEntryId: entry.id, description,
      },
    });

    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const user = await loadUserOrThrow(req.userId);
    const result = await ledgerClient.listSavingsAccounts(user.id);
    res.json({ success: true, data: result.savingsAccounts });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
