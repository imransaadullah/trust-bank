const express = require('express');
const prisma = require('../db/prismaClient');
const config = require('../config');
const { getIdentityProvider } = require('../identity/registry');
const jwtService = require('../services/jwtService');
const ledgerClient = require('../services/ledgerClient');
const logger = require('../utils/logger');

const router = express.Router();

const identityProvider = getIdentityProvider(config.identityProvider, config.authCore);

router.post('/send-otp', async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'phone is required' });
    }
    await identityProvider.sendOtp(phone);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/verify-otp', async (req, res, next) => {
  try {
    const { phone, code, deviceId } = req.body;
    if (!phone || !code || !deviceId) {
      return res.status(400).json({ success: false, error: 'phone, code, and deviceId are required' });
    }

    const verified = await identityProvider.verifyOtp(phone, code);
    if (!verified.verified || verified.phoneNumber !== phone) {
      return res.status(401).json({ success: false, error: 'Phone verification failed' });
    }

    let user = await prisma.user.findUnique({ where: { phoneNumber: phone } });

    if (!user) {
      user = await prisma.user.create({
        data: { phoneNumber: phone, identityProviderUid: verified.providerUid },
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

    // Device binding (CBN, mandatory since July 1, 2026): trustpay-backend
    // owns the fact ("has this device been seen for this user, since
    // when") — services/compliance owns the policy (cooldown, cap) and
    // is consulted at transaction time in routes/wallet.js, not here.
    const existingDevice = await prisma.device.findUnique({
      where: { userId_deviceId: { userId: user.id, deviceId } },
    });
    const isNewDevice = !existingDevice;
    if (existingDevice) {
      await prisma.device.update({ where: { id: existingDevice.id }, data: { lastSeenAt: new Date() } });
    } else {
      await prisma.device.create({ data: { userId: user.id, deviceId } });
    }

    const token = jwtService.mintToken(user, deviceId);
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id, phoneNumber: user.phoneNumber, kycTier: user.kycTier,
          walletReady: !!user.ledgerAccountId,
        },
        isNewDevice,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
