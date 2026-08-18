// Login always requires MFA — there is no path from a bare password to a
// real StaffSession, enrolled or not (architecture doc section 7: MFA is
// mandatory for staff/admin access). A not-yet-enrolled user gets routed
// through /mfa/enroll + /mfa/enroll/confirm instead of /login/mfa, using
// the exact same challenge-token mechanism either way.
const express = require('express');
const staffUserService = require('../services/staffUserService');
const staffSessionService = require('../services/staffSessionService');
const mfaChallengeService = require('../services/mfaChallengeService');

const router = express.Router();

router.post('/v1/login', async (req, res, next) => {
  try {
    const { tenantId, email, password } = req.body;
    if (!tenantId || !email || !password) {
      return res.status(400).json({ success: false, error: 'tenantId, email, and password are required' });
    }
    const staff = await staffUserService.verifyPassword({ tenantId, email, password });
    const mfaChallengeToken = mfaChallengeService.issue(staff.id);
    res.json({ success: true, data: { mfaChallengeToken, mfaEnrolled: staff.mfaEnabled } });
  } catch (err) {
    next(err);
  }
});

router.post('/v1/mfa/enroll', async (req, res, next) => {
  try {
    const { mfaChallengeToken } = req.body;
    if (!mfaChallengeToken) {
      return res.status(400).json({ success: false, error: 'mfaChallengeToken is required' });
    }
    const staffUserId = mfaChallengeService.verify(mfaChallengeToken);
    const { otpauthUri } = await staffUserService.beginMfaEnrollment(staffUserId);
    res.json({ success: true, data: { otpauthUri } });
  } catch (err) {
    next(err);
  }
});

router.post('/v1/mfa/enroll/confirm', async (req, res, next) => {
  try {
    const { mfaChallengeToken, code } = req.body;
    if (!mfaChallengeToken || !code) {
      return res.status(400).json({ success: false, error: 'mfaChallengeToken and code are required' });
    }
    const staffUserId = mfaChallengeService.verify(mfaChallengeToken);
    await staffUserService.confirmMfaEnrollment(staffUserId, code);
    const { token, session } = await staffSessionService.issue(staffUserId);
    res.status(201).json({ success: true, data: { sessionToken: token, expiresAt: session.expiresAt } });
  } catch (err) {
    next(err);
  }
});

router.post('/v1/login/mfa', async (req, res, next) => {
  try {
    const { mfaChallengeToken, code } = req.body;
    if (!mfaChallengeToken || !code) {
      return res.status(400).json({ success: false, error: 'mfaChallengeToken and code are required' });
    }
    const staffUserId = mfaChallengeService.verify(mfaChallengeToken);
    await staffUserService.verifyMfaCode(staffUserId, code);
    const { token, session } = await staffSessionService.issue(staffUserId);
    res.status(201).json({ success: true, data: { sessionToken: token, expiresAt: session.expiresAt } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
