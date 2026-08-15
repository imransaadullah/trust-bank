// Consolidates the former authCoreClient.js + authTokenVerifier.js into
// one provider file — same shape as services/payments' paystack.js,
// which keeps all of one vendor's HTTP logic in a single place rather
// than splitting it across client/verifier files. Behavior unchanged
// from those two files; this is a move, not a rewrite. AuthCore is the
// same account TrustChat already uses.
const axios = require('axios');
const { jwtVerify, createRemoteJWKSet } = require('jose');
const { IdentityProvider } = require('./identityProvider');

class AuthCoreProvider extends IdentityProvider {
  constructor(config) {
    super('authcore');
    this.baseUrl = config.baseUrl;
    this.projectKey = config.projectKey;
    this.jwksUrl = config.jwksUrl;
    this.projectId = config.projectId;
    this._jwks = null;
  }

  async _request(path, body) {
    try {
      const response = await axios.post(`${this.baseUrl}${path}`, body, {
        headers: { 'Content-Type': 'application/json', 'x-authcore-key': this.projectKey },
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

  _getJwks() {
    if (!this._jwks) {
      if (!this.jwksUrl) {
        throw new Error('AuthCoreProvider: AUTHCORE_JWKS_URL is not configured');
      }
      this._jwks = createRemoteJWKSet(new URL(this.jwksUrl));
    }
    return this._jwks;
  }

  /** Sends a one-time code to the given phone via AuthCore. */
  async sendOtp(phoneNumber) {
    return this._request('/api/auth/otp/send', { phone: phoneNumber });
  }

  /** Verifies the code and the access_token AuthCore returns for it. */
  async verifyOtp(phoneNumber, code) {
    const { access_token: accessToken } = await this._request('/api/auth/otp/verify', { phone: phoneNumber, code });

    const { payload } = await jwtVerify(accessToken, this._getJwks(), {
      issuer: 'authcore',
      audience: this.projectId,
    });

    return {
      verified: !!payload.phone_verified && payload.phone === phoneNumber,
      phoneNumber: payload.phone || null,
      providerUid: payload.sub,
    };
  }
}

module.exports = { AuthCoreProvider };
