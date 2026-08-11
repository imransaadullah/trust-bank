const express = require('express');
const prisma = require('../db/prismaClient');
const authCoreClient = require('../services/authCoreClient');
const authTokenVerifier = require('../services/authTokenVerifier');
const jwtService = require('../services/jwtService');
const ledgerClient = require('../services/ledgerClient');
const logger = require('../utils/logger');

const router = express.Router();

router.post('/send-otp', async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'phone is required' });
    }
    await authCoreClient.sendPhoneOtp(phone);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/verify-otp', async (req, res, next) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ success: false, error: 'phone and code are required' });
    }

    const { access_token: accessToken } = await authCoreClient.verifyPhoneOtp(phone, code);
    const verified = await authTokenVerifier.verifyAuthCoreToken(accessToken);
    if (!verified.phoneVerified || verified.phoneNumber !== phone) {
      return res.status(401).json({ success: false, error: 'Phone verification failed' });
    }

    let user = await prisma.user.findUnique({ where: { phoneNumber: phone } });

    if (!user) {
      user = await prisma.user.create({
        data: { phoneNumber: phone, authCoreUid: verified.providerUid },
      });

      try {
        const ledgerAccount = await ledgerClient.openAccount({
          externalCustomerId: user.id, productType: 'wallet', kycTier: 0,
        });
        user = await prisma.user.update({
          where: { id: user.id },
          data: { ledgerAccountId: ledgerAccount.id, ledgerAccountNumber: ledgerAccount.accountNumber },
        });
      } catch (err) {
        // The User row already exists even if wallet provisioning failed —
        // don't lose the account over a transient Ledger error. The next
        // login attempt (or a dedicated retry route, not built yet) can
        // pick this back up since ledgerAccountId stays null until it works.
        logger.error(`[Auth] Failed to open Ledger wallet for new user ${user.id}: ${err.message}`);
      }
    }

    const token = jwtService.mintToken(user);
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id, phoneNumber: user.phoneNumber, kycTier: user.kycTier,
          walletReady: !!user.ledgerAccountId,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
