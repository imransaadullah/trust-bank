// The one real, demonstrable endpoint this slice ships beyond auth
// plumbing — proves the whole login -> MFA -> session chain end to end
// without needing slice 2's maker-checker orchestration to exist yet.
const express = require('express');
const { requireStaffSession } = require('../middleware/requireStaffSession');

const router = express.Router();

router.get('/v1/me', requireStaffSession(), (req, res) => {
  res.json({ success: true, data: req.staff });
});

module.exports = router;
