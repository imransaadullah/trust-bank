// Lifted from truechat/backend/src/services/authCoreOtpService.js — same
// AuthCore account TrustChat already uses, same request shape. The
// project key is a secret and must only ever be called from here, never
// exposed to the app (see AUTHCORE_SCOPED_CLIENT_KEY_SPEC.md for why).
const axios = require('axios');
const config = require('../config');

async function _request(path, body) {
  try {
    const response = await axios.post(`${config.authCore.baseUrl}${path}`, body, {
      headers: { 'Content-Type': 'application/json', 'x-authcore-key': config.authCore.projectKey },
      timeout: 10000,
    });
    return response.data;
  } catch (error) {
    if (error.response) {
      const { data } = error.response;
      const err = new Error(data?.message || 'AuthCore request failed');
      err.code = data?.error || 'upstream_error';
      err.statusCode = error.response.status;
      throw err;
    }
    throw error;
  }
}

/** Sends a one-time code to the given phone via AuthCore. */
function sendPhoneOtp(phone) {
  return _request('/api/auth/otp/send', { phone });
}

/** Verifies the code and returns { access_token, refresh_token, user }. */
function verifyPhoneOtp(phone, code) {
  return _request('/api/auth/otp/verify', { phone, code });
}

module.exports = { sendPhoneOtp, verifyPhoneOtp };
