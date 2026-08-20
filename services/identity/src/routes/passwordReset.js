// Self-service forgot-password — no auth on either route: /request
// proves nothing about identity (same posture as /v1/login's first
// step), and /confirm's token *is* the credential.
const express = require('express');
const passwordResetService = require('../services/passwordResetService');

const router = express.Router();

router.post('/v1/password-reset/request', async (req, res, next) => {
  try {
    const { tenantId, email } = req.body;
    if (!tenantId || !email) {
      return res.status(400).json({ success: false, error: 'tenantId and email are required' });
    }
    const result = await passwordResetService.request({ tenantId, email });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/v1/password-reset/confirm', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, error: 'token and newPassword are required' });
    }
    const result = await passwordResetService.confirm({ token, newPassword });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
