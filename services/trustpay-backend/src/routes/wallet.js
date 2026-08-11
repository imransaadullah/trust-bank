const express = require('express');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../db/prismaClient');
const ledgerClient = require('../services/ledgerClient');
const paymentsClient = require('../services/paymentsClient');
const complianceClient = require('../services/complianceClient');
const { requireAuth } = require('../middleware/auth');
const { generateReference } = require('../utils/reference');
const { UserNotFoundError, KYCTierRequiredError, ComplianceDeniedError } = require('../utils/errors');

const router = express.Router();

async function loadUserOrThrow(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UserNotFoundError();
  return user;
}

async function amountTransactedTodayKobo(userId) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const result = await prisma.transaction.aggregate({
    where: { userId, type: { in: ['withdrawal', 'p2p_sent'] }, createdAt: { gte: startOfToday }, status: { not: 'reversed' } },
    _sum: { amount: true },
  });
  return result._sum.amount || 0;
}

// The one call site both /transfer and /withdraw go through instead of a
// hardcoded `if (user.kycTier < 1)` amount check — see
// COMPLIANCE_DESIGN_AND_BACKLOG.md. Two distinct checks, deliberately:
// the KYC-tier limit is a CBN-mandated daily/single-txn cap (skipped for
// kycTier 0 — that's our own pre-verification onboarding gate, not a
// CBN tier, so there's no policy to check against). Device binding
// applies regardless of tier — CBN's rule caps a new device "even for
// fully-verified Tier 3 accounts."
async function enforceCompliance({ user, deviceId, amount }) {
  if (user.kycTier >= 1) {
    const spentToday = await amountTransactedTodayKobo(user.id);
    const kycDecision = await complianceClient.checkKYCTier({
      userId: user.id, tier: user.kycTier, amount, amountTransactedTodayKobo: spentToday,
    });
    if (!kycDecision.allowed) throw new ComplianceDeniedError(kycDecision.reason);
  }

  const device = deviceId
    ? await prisma.device.findUnique({ where: { userId_deviceId: { userId: user.id, deviceId } } })
    : null;
  const deviceAgeHours = device ? (Date.now() - device.firstSeenAt.getTime()) / 3_600_000 : 0;
  const deviceDecision = await complianceClient.checkDevice({
    userId: user.id, isNewDevice: !device, deviceAgeHours, amount,
  });
  if (!deviceDecision.allowed) throw new ComplianceDeniedError(deviceDecision.reason);
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

    await enforceCompliance({ user: sender, deviceId: req.deviceId, amount });

    const reference = generateReference('P2P');
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

    await enforceCompliance({ user, deviceId: req.deviceId, amount });

    const reference = generateReference('WD');
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
