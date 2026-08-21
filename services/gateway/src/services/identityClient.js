// Server-to-server verification of a raw Identity staff-session token
// (stf_live_...) — repurposing Identity's own GET /v1/me (built for its
// browser console) as a verification primitive for a second, independent
// consumer. No new Identity code needed: the route already accepts
// nothing but a bearer token and returns {id, tenantId, email, role,
// branchId}, with no browser-specific requirement. This is genuinely new
// territory for this platform — every other cross-service call here is
// one service using its OWN stored machine credential against another
// service, not verifying a human bearer token a third party (the
// browser) handed it. See routes/staffLogin.js for how the result is
// used.
const axios = require('axios');
const config = require('../config');
const { StaffSessionInvalidError } = require('../utils/errors');

async function verifyStaffSession(token) {
  try {
    const response = await axios.get(`${config.identity.baseUrl}/v1/me`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    return response.data.data;
  } catch (err) {
    if (err.response && err.response.status === 401) {
      throw new StaffSessionInvalidError();
    }
    throw err;
  }
}

module.exports = { verifyStaffSession };
