const express = require('express');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../db/prismaClient');
const ledgerClient = require('../services/ledgerClient');
const paymentsClient = require('../services/paymentsClient');
const { enforceCompliance } = require('../services/complianceEnforcement');
const { requireAuth } = require('../middleware/auth');
const { generateReference } = require('../utils/reference');
const { UserNotFoundError, KYCTierRequiredError } = require('../utils/errors');

const router = express.Router();

async function loadUserOrThrow(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UserNotFoundError();
  return user;
}

router.get('/balance', requireAuth, async (req, res, next) => {
  try {
    const user = await loadUserOrThrow(req.userId);
    if (!user.ledgerAccountId) {
      return res.json({ success: true, data: { amount: 0, walletReady: false } });
    }
    const balance = await ledgerClient.getBalance(user.ledgerAccountId);
    res.json({ success: true, data: { amount: balance.amount, walletReady: true } });
  } catch (err) {
    next(err);
  }
});

router.get('/deposit-account', requireAuth, async (req, res, next) => {
  try {
    const user = await loadUserOrThrow(req.userId);
    if (user.kycTier < 1) throw new KYCTierRequiredError(1);
    const account = await paymentsClient.getAccount(user.id);
    res.json({ success: true, data: { accountNumber: account.accountNumber, bankName: account.bankName } });
  } catch (err) {
    next(err);
  }
});

router.post('/transfer', requireAuth, async (req, res, next) => {
  try {
    const { toPhoneNumber, amount, description } = req.body;
    if (!toPhoneNumber || !amount) {
      return res.status(400).json({ success: false, error: 'toPhoneNumber and amount are required' });
    }

    const sender = await loadUserOrThrow(req.userId);
    const recipient = await prisma.user.findUnique({ where: { phoneNumber: toPhoneNumber } });
    if (!recipient) {
      return res.status(404).json({ success: false, error: 'No TrustPay user with that phone number' });
    }

    const reference = generateReference('P2P');
    await enforceCompliance({
      user: sender, deviceId: req.deviceId, amount, counterpartyId: recipient.id, transactionRef: reference,
    });

    const entry = await ledgerClient.transferP2P({
      fromExternalCustomerId: sender.id, toExternalCustomerId: recipient.id,
      amount, reference, idempotencyKey: uuidv4(), description,
    });

    await prisma.$transaction([
      prisma.transaction.create({
        data: {
          userId: sender.id, type: 'p2p_sent', amount, counterpartyUserId: recipient.id,
          counterpartyLabel: recipient.phoneNumber, journalEntryId: entry.id, description,
        },
      }),
      prisma.transaction.create({
        data: {
          userId: recipient.id, type: 'p2p_received', amount, counterpartyUserId: sender.id,
          counterpartyLabel: sender.phoneNumber, journalEntryId: entry.id, description,
        },
      }),
    ]);

    res.status(201).json({ success: true, data: { journalEntryId: entry.id, reference } });
  } catch (err) {
    next(err);
  }
});

router.post('/withdraw', requireAuth, async (req, res, next) => {
  try {
    const { amount, beneficiaryAccountNumber, beneficiaryBankCode, beneficiaryName, description } = req.body;
    if (!amount || !beneficiaryAccountNumber || !beneficiaryBankCode) {
      return res.status(400).json({ success: false, error: 'amount, beneficiaryAccountNumber, and beneficiaryBankCode are required' });
    }

    const user = await loadUserOrThrow(req.userId);
    if (user.kycTier < 1) throw new KYCTierRequiredError(1);

    const reference = generateReference('WD');
    await enforceCompliance({
      user, deviceId: req.deviceId, amount, counterpartyId: beneficiaryAccountNumber,
      transactionRef: reference, namesToScreen: [beneficiaryName],
    });
    // Debit first — the Ledger's insufficient-balance guard is the
    // authoritative check. If the payout below fails, Payments reverses
    // this same entry itself (see services/payments/settlementService.js).
    const entry = await ledgerClient.recordWithdrawal({
      externalCustomerId: user.id, amount, reference, idempotencyKey: uuidv4(), description,
    });

    let status = 'completed';
    try {
      const payout = await paymentsClient.initiatePayout({
        externalCustomerId: user.id, amount, beneficiaryAccountNumber, beneficiaryBankCode,
        beneficiaryName, reference, debitJournalEntryId: entry.id, description,
      });
      status = payout.status === 'resolved' ? 'completed' : 'pending';
    } catch (err) {
      await prisma.transaction.create({
        data: {
          userId: user.id, type: 'withdrawal', amount, counterpartyLabel: beneficiaryAccountNumber,
          journalEntryId: entry.id, status: 'reversed', description,
        },
      });
      throw err;
    }

    await prisma.transaction.create({
      data: {
        userId: user.id, type: 'withdrawal', amount, counterpartyLabel: beneficiaryAccountNumber,
        journalEntryId: entry.id, status, description,
      },
    });

    res.status(201).json({ success: true, data: { journalEntryId: entry.id, reference, status } });
  } catch (err) {
    next(err);
  }
});

router.get('/transactions', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const transactions = await prisma.transaction.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    res.json({ success: true, data: transactions });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
