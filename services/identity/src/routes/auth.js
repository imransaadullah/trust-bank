// Login always requires MFA — there is no path from a bare password to a
// real StaffSession, enrolled or not (architecture doc section 7: MFA is
// mandatory for staff/admin access). A not-yet-enrolled user gets routed
// through /mfa/enroll + /mfa/enroll/confirm instead of /login/mfa, using
// the exact same challenge-token mechanism either way.
const express = require('express');
const argon2 = require('argon2');
const staffUserService = require('../services/staffUserService');
const staffSessionService = require('../services/staffSessionService');
const mfaChallengeService = require('../services/mfaChallengeService');
const { requireStaffSession } = require('../middleware/requireStaffSession');
const { InvalidCredentialsError } = require('../utils/errors');

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

// Requires knowing the current password — no email round-trip needed,
// unlike /password-reset. Keeps the requesting session alive (staff.id
// is the caller's own), revokes every other session for this user, same
// "a password change kills other sessions" security posture
// /password-reset/confirm uses (there, it's every session, since a
// reset implies you no longer trust any existing one).
router.post('/v1/change-password', requireStaffSession(), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 12) {
      return res.status(400).json({ success: false, error: 'newPassword must be at least 12 characters' });
    }

    const staff = await staffUserService.get(req.staff.id);
    const valid = await argon2.verify(staff.passwordHash, currentPassword);
    if (!valid) throw new InvalidCredentialsError();

    await staffUserService.updatePassword({ staffUserId: req.staff.id, newPassword });
    await staffSessionService.revokeAllForStaffUser(req.staff.id, { exceptSessionId: req.staffSessionId });

    res.json({ success: true, data: { changed: true } });
  } catch (err) {
    next(err);
  }
});

// Self-logout — until now, "logging out" only ever meant the client
// discarding its own token; the server-side StaffSession row stayed
// 'active' until its 30-minute idle timeout lapsed. Real revocation,
// not just a client-side no-op.
router.post('/v1/logout', requireStaffSession(), async (req, res, next) => {
  try {
    await staffSessionService.revoke(req.staffSessionId);
    res.json({ success: true, data: { loggedOut: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
