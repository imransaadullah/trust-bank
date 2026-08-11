// Adapted from truechat/backend/src/services/authTokenVerifier.js —
// JWKS-only here, no Firebase fallback, since TrustPay never had a
// Firebase migration to support. Verifies the access_token AuthCore
// returns from verifyPhoneOtp before this backend trusts it and mints
// its own JWT.
const { jwtVerify, createRemoteJWKSet } = require('jose');
const config = require('../config');

let jwks = null;
function getJwks() {
  if (!jwks) {
    if (!config.authCore.jwksUrl) {
      throw new Error('authTokenVerifier: AUTHCORE_JWKS_URL is not configured');
    }
    jwks = createRemoteJWKSet(new URL(config.authCore.jwksUrl));
  }
  return jwks;
}

async function verifyAuthCoreToken(token) {
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: 'authcore',
    audience: config.authCore.projectId,
  });
  return {
    phoneNumber: payload.phone || null,
    phoneVerified: !!payload.phone_verified,
    providerUid: payload.sub,
  };
}

module.exports = { verifyAuthCoreToken };
