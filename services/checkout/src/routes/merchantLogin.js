// The merchant-dashboard login flow — no pre-auth middleware on send/
// verify, since these routes ARE the authentication step. See
// merchantAuthService.js for the real orchestration.
const express = require('express');
const merchantAuthService = require('../services/merchantAuthService');
const merchantSessionService = require('../services/merchantSessionService');
const { resolveMerchantScope } = require('../middleware/merchantAuth');

const router = express.Router();

router.post('/:tenantId/merchant-login/send-otp', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'email is required' });
    }
    const result = await merchantAuthService.sendOtp(email);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/merchant-login/verify-otp', async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'email and code are required' });
    }
    const { token, session, merchant } = await merchantAuthService.verifyOtp({
      tenantId: req.params.tenantId, email, code,
    });
    res.status(201).json({
      success: true,
      data: { token, tenantId: session.tenantId, merchantId: merchant.id, merchantName: merchant.name, expiresAt: session.expiresAt },
    });
  } catch (err) {
    next(err);
  }
});

// A real gws_live_-style logout, not a client-side no-op — see
// merchantSessionService.revoke.
router.post('/:tenantId/merchant-login/logout', resolveMerchantScope(), async (req, res, next) => {
  try {
    if (req.merchantSession) {
      await merchantSessionService.revoke(req.merchantSession.id);
    }
    res.json({ success: true, data: { loggedOut: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
