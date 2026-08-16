const express = require('express');
const prisma = require('../db/prismaClient');
const paymentsClient = require('../services/paymentsClient');
const { requireAuth } = require('../middleware/auth');
const { UserNotFoundError } = require('../utils/errors');

const router = express.Router();

router.post('/verify-identity', requireAuth, async (req, res, next) => {
  try {
    const { type, number, firstName, lastName } = req.body;
    if (!['bvn', 'nin'].includes(type) || !number || !firstName || !lastName) {
      return res.status(400).json({ success: false, error: 'type (bvn|nin), number, firstName, and lastName are required' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) throw new UserNotFoundError();

    if (user.kycTier >= 1) {
      return res.json({ success: true, data: { kycTier: user.kycTier, kycStatus: user.kycStatus, alreadyVerified: true } });
    }

    const identity = await paymentsClient.verifyIdentity({ type, number, firstName, lastName });
    if (!identity.verified) {
      await prisma.user.update({ where: { id: user.id }, data: { kycStatus: 'rejected' } });
      return res.status(422).json({ success: false, error: 'Identity verification did not match' });
    }

    const account = await paymentsClient.provisionAccount({
      externalCustomerId: user.id, firstName, lastName, phoneNumber: user.phoneNumber,
    });

    // matchedName is the provider's own match, present whenever it
    // returned actual name strings rather than a boolean match flag
    // (see PaystackProvider.verifyIdentity) — fall back to what the
    // caller supplied only if the provider didn't return one, so this
    // is never left null on a real, successful verification.
    const verifiedFullName = identity.matchedName || `${firstName} ${lastName}`;

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { kycTier: 1, kycStatus: 'verified', bvnVerifiedAt: new Date(), verifiedFullName },
    });

    res.json({
      success: true,
      data: {
        kycTier: updated.kycTier, kycStatus: updated.kycStatus,
        depositAccount: { accountNumber: account.accountNumber, bankName: account.bankName },
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) throw new UserNotFoundError();
    res.json({ success: true, data: { kycTier: user.kycTier, kycStatus: user.kycStatus, bvnVerifiedAt: user.bvnVerifiedAt } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
