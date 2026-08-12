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

router.get('/billers', requireAuth, async (req, res, next) => {
  try {
    const billers = await paymentsClient.getBillers(req.query.type || null);
    res.json({ success: true, data: billers });
  } catch (err) {
    next(err);
  }
});

// Doesn't move money — no ledger/compliance involvement, just a lookup
// against the tenant's configured biller before the app shows a
// confirmation screen.
router.post('/verify', requireAuth, async (req, res, next) => {
  try {
    const { billerCode, customerId } = req.body;
    if (!billerCode || !customerId) {
      return res.status(400).json({ success: false, error: 'billerCode and customerId are required' });
    }
    const result = await paymentsClient.verifyBillCustomer({ billerCode, customerId });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/pay', requireAuth, async (req, res, next) => {
  try {
    const { billerCode, customerId, amount, planCode, customerName, phone, description } = req.body;
    if (!billerCode || !customerId || !amount) {
      return res.status(400).json({ success: false, error: 'billerCode, customerId, and amount are required' });
    }

    const user = await loadUserOrThrow(req.userId);
    if (user.kycTier < 1) throw new KYCTierRequiredError(1);

    const reference = generateReference('BILL');
    // A bill payment is money leaving the system to a third party — the
    // same compliance surface as a withdrawal, not exempted the way
    // savings funding is (savings stays inside the institution's
    // control; this explicitly doesn't).
    await enforceCompliance({
      user, deviceId: req.deviceId, amount, counterpartyId: billerCode,
      transactionRef: reference, namesToScreen: customerName ? [customerName] : [],
    });

    // Debit first, same ordering as /wallet/withdraw — the Ledger's
    // insufficient-balance guard is authoritative. If the purchase below
    // fails, Payments reverses this same entry itself (see
    // services/payments/billsService.js).
    const entry = await ledgerClient.recordWithdrawal({
      externalCustomerId: user.id, amount, reference, idempotencyKey: uuidv4(),
      description: description || `Bill payment: ${billerCode}`,
    });

    let attempt;
    try {
      attempt = await paymentsClient.purchaseBill({
        externalCustomerId: user.id, billerCode, customerId, amount, planCode,
        customerName, phone, reference, debitJournalEntryId: entry.id,
      });
    } catch (err) {
      await prisma.transaction.create({
        data: {
          userId: user.id, type: 'bill_payment', amount, counterpartyLabel: billerCode,
          journalEntryId: entry.id, status: 'reversed', description,
          metadata: { billerCode, customerId, planCode },
        },
      });
      throw err;
    }

    const status = attempt.status === 'resolved' ? 'completed' : attempt.status === 'failed' ? 'reversed' : 'pending';
    await prisma.transaction.create({
      data: {
        userId: user.id, type: 'bill_payment', amount, counterpartyLabel: billerCode,
        journalEntryId: entry.id, status, description,
        metadata: { billerCode, customerId, planCode },
      },
    });

    res.status(201).json({ success: true, data: { journalEntryId: entry.id, reference, status } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
