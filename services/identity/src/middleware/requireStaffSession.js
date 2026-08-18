// Mirrors requireApiKey's exact shape (services/payments/src/middleware/
// auth.js): bearer token -> indexed prefix lookup -> hash compare ->
// status/expiry check -> attach the caller's identity to req. The one
// addition machine-credential auth doesn't need: an optional role gate,
// since staff (unlike a service credential) hold one of a fixed set of
// roles rather than a single admin/operate scope.
const staffSessionService = require('../services/staffSessionService');

function requireStaffSession({ roles } = {}) {
  return async (req, res, next) => {
    try {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const token = auth.slice('Bearer '.length);

      const { staff } = await staffSessionService.verify(token);

      if (roles && !roles.includes(staff.role)) {
        return res.status(403).json({ success: false, error: `This route requires role: ${roles.join(' or ')}` });
      }

      req.staff = {
        id: staff.id, tenantId: staff.tenantId, email: staff.email,
        role: staff.role, branchId: staff.branchId,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireStaffSession };
