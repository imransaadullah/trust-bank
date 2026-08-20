// Admin-initiated reset — for a staff member who's lost both their
// password and email access, or is being force-rotated. Same
// high-entropy temp-password generation as scripts/bootstrapStaffUser.js,
// just as an HTTP route instead of a script (this one needs an
// authenticated ops_admin, unlike the bootstrap script's chicken-and-egg
// direct-DB-access case).
const express = require('express');
const crypto = require('crypto');
const staffUserService = require('../services/staffUserService');
const staffSessionService = require('../services/staffSessionService');
const { requireStaffSession } = require('../middleware/requireStaffSession');
const { StaffUserNotFoundError } = require('../utils/errors');

const router = express.Router();

router.post('/v1/staff/:staffUserId/reset-password', requireStaffSession({ roles: ['ops_admin'] }), async (req, res, next) => {
  try {
    const staff = await staffUserService.get(req.params.staffUserId);
    if (staff.tenantId !== req.staff.tenantId) throw new StaffUserNotFoundError(req.params.staffUserId);

    const temporaryPassword = crypto.randomBytes(18).toString('base64url');
    await staffUserService.updatePassword({ staffUserId: staff.id, newPassword: temporaryPassword });
    await staffSessionService.revokeAllForStaffUser(staff.id);

    res.json({
      success: true,
      data: {
        staffUserId: staff.id, email: staff.email,
        // The only place this ever appears — store it now.
        temporaryPassword,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
