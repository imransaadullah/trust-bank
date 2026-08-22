// Orchestrates the merchant-dashboard login flow: send/verify an OTP
// through the configured AuthProvider (a single, shared instance — see
// config/index.js's own comment on why this isn't per-tenant), resolve a
// real Merchant by {tenantId, email}, and issue this service's own
// MerchantSession — never AuthCore's own access_token, same "one-shot
// verification, mint our own session" precedent services/trustpay-backend
// already established.
const prisma = require('../db/prismaClient');
const config = require('../config');
const { getAuthProvider } = require('../providers/authProviders/registry');
const merchantSessionService = require('./merchantSessionService');
const { MerchantAuthInvalidError } = require('../utils/errors');

const authProvider = getAuthProvider(config.authProvider.name, config.authProvider);

/**
 * Always resolves successfully regardless of whether a merchant with this
 * email exists — no enumeration signal, matching Identity's own password-
 * reset precedent ("identical response whether the email exists or not").
 */
async function sendOtp(email) {
  await authProvider.sendOtp(email);
  return { sent: true };
}

/**
 * @returns {Promise<{token, session}>}
 * @throws {MerchantAuthInvalidError} the OTP verified but no active
 *   merchant matches {tenantId, email} — a real account distinction, not
 *   an auth-provider concern.
 */
async function verifyOtp({ tenantId, email, code }) {
  const result = await authProvider.verifyOtp(email, code);
  if (!result.verified) {
    throw new MerchantAuthInvalidError();
  }

  const merchant = await prisma.merchant.findFirst({ where: { tenantId, email, status: 'active' } });
  if (!merchant) {
    throw new MerchantAuthInvalidError();
  }

  if (!merchant.identityProviderUid) {
    await prisma.merchant.update({ where: { id: merchant.id }, data: { identityProviderUid: result.providerUid } });
  }

  const { session, token } = await merchantSessionService.issue({
    tenantId, merchantId: merchant.id, merchantEmail: merchant.email,
  });

  return { token, session, merchant };
}

module.exports = { sendOtp, verifyOtp, authProvider };
