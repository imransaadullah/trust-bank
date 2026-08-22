// Mirrors services/trustpay-backend/src/identity/authCoreProvider.js
// exactly (same account — trustmail.ng's AuthCore, self-hosted, "AuthCore
// docs" confirm POST /api/auth/otp/send and /verify accept an `email`
// field interchangeably with `phone`, same two endpoints) — only the
// identifier field name changes, phone -> email, since a Merchant has no
// phone on file. `x-authcore-key` here is the SECRET (`proj_...`) tier,
// not the publishable (`pk_...`) tier the docs' bot-protection/PoW section
// covers — this is a trusted server-to-server call from Checkout's own
// backend, never embedded in the merchant-console frontend, so no
// proof-of-work/recaptcha_token is needed (the same reason trustpay-
// backend's own implementation never sends one either).
const axios = require('axios');
const { jwtVerify, createRemoteJWKSet } = require('jose');
const { AuthProvider } = require('./authProvider');

class AuthCoreProvider extends AuthProvider {
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

  /** Sends a one-time code to the given email via AuthCore. */
  async sendOtp(email) {
    return this._request('/api/auth/otp/send', { email });
  }

  /** Verifies the code and the access_token AuthCore returns for it. */
  async verifyOtp(email, code) {
    const { access_token: accessToken } = await this._request('/api/auth/otp/verify', { email, code });

    const { payload } = await jwtVerify(accessToken, this._getJwks(), {
      issuer: 'authcore',
      audience: this.projectId,
    });

    return {
      verified: !!payload.email_verified && payload.email === email,
      email: payload.email || null,
      providerUid: payload.sub,
    };
  }
}

module.exports = { AuthCoreProvider };
