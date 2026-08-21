// The staff-session login bridge: exchanges a pasted Identity staff
// session token (stf_live_..., already held from being logged into the
// staff console) for a Gateway-native GatewaySession — an alternative to
// pasting a raw gw_live_ admin API key. No pre-auth middleware here —
// this route IS the authentication step, establishing identity from the
// Identity token itself via identityClient.verifyStaffSession.
const express = require('express');
const identityClient = require('../services/identityClient');
const gatewaySessionService = require('../services/gatewaySessionService');
const { requireAdminAccess } = require('../middleware/auth');

const router = express.Router();

router.post('/:tenantId/staff-login', async (req, res, next) => {
  try {
    const { staffSessionToken } = req.body;
    if (!staffSessionToken) {
      return res.status(400).json({ success: false, error: 'staffSessionToken is required' });
    }

    const staff = await identityClient.verifyStaffSession(staffSessionToken);

    // Only ops_admin maps to gateway admin access — the tenant's actual
    // administrative role, not merely "tenant-wide" (compliance_officer
    // and credit_manager are tenant-wide too, but manage banking
    // operations, not integration credentials).
    if (staff.role !== 'ops_admin') {
      return res.status(403).json({ success: false, error: 'Only ops_admin staff can sign into the tenant dashboard' });
    }
    if (staff.tenantId !== req.params.tenantId) {
      return res.status(403).json({ success: false, error: 'Staff session is not authorized for this tenant' });
    }

    const { session, token } = await gatewaySessionService.issue({
      tenantId: staff.tenantId, staffUserId: staff.id, staffEmail: staff.email,
    });

    res.status(201).json({
      success: true,
      data: { token, tenantId: session.tenantId, staffEmail: session.staffEmail, expiresAt: session.expiresAt },
    });
  } catch (err) {
    next(err);
  }
});

// A gws_live_ session has a real server-side row to revoke, unlike a
// gw_live_ API key (which has nothing "session-shaped" to log out of —
// see AppShell.tsx's own comment). No-op when authenticated via API key.
router.post('/:tenantId/logout', requireAdminAccess(), async (req, res, next) => {
  try {
    if (req.gatewaySession) {
      await gatewaySessionService.revoke(req.gatewaySession.id);
    }
    res.json({ success: true, data: { loggedOut: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
