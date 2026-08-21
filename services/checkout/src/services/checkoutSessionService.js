const { v4: uuidv4 } = require('uuid');
const prisma = require('../db/prismaClient');
const config = require('../config');
const merchantService = require('./merchantService');
const tenantCheckoutProviderConfigService = require('./tenantCheckoutProviderConfigService');
const checkoutWebhookService = require('./checkoutWebhookService');
const { CheckoutSessionNotFoundError, CheckoutSessionNotCancellableError } = require('../utils/errors');

async function create({ tenantId, merchantId, amountKobo, customerEmail, description, metadata, idempotencyKey }) {
  const existing = await prisma.checkoutSession.findUnique({
    where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
  });
  if (existing) return existing;

  await merchantService.requireExists({ tenantId, merchantId });
  const { provider } = await tenantCheckoutProviderConfigService.getProviderForTenant(tenantId);

  const id = uuidv4();
  const reference = `chk_${uuidv4()}`;
  const callbackUrl = `${config.publicBaseUrl}/pay/${id}`;

  const { authorizationUrl, providerRef } = await provider.initializeTransaction({
    reference, amountKobo, email: customerEmail, callbackUrl, metadata,
  });

  const expiresAt = new Date(Date.now() + config.checkoutSession.defaultExpiryMinutes * 60_000);

  return prisma.checkoutSession.create({
    data: {
      id, tenantId, merchantId, reference, provider: provider.name, providerRef, authorizationUrl,
      amountKobo, customerEmail, description, metadata, idempotencyKey, expiresAt,
    },
  });
}

async function get({ tenantId, sessionId }) {
  const session = await prisma.checkoutSession.findFirst({ where: { id: sessionId, tenantId } });
  if (!session) throw new CheckoutSessionNotFoundError(sessionId);
  return session;
}

/**
 * The concrete implementation of "GET verify/:reference is the
 * authoritative status check" — used by the hosted page's own GET
 * handler to cover the race between the customer's redirect-back and
 * the provider's webhook. A lazy expiry check happens here too (no cron
 * needed for something this cheap to check at read time).
 */
async function getAndSync({ tenantId, sessionId }) {
  let session = await get({ tenantId, sessionId });

  if (session.status === 'pending' && new Date() > session.expiresAt) {
    session = await prisma.checkoutSession.update({ where: { id: session.id }, data: { status: 'expired' } });
    return session;
  }

  if ((session.status === 'pending' || session.status === 'processing') && session.provider !== 'noop') {
    const { provider } = await tenantCheckoutProviderConfigService.getProviderForTenant(tenantId);
    const result = await provider.verifyTransaction(session.reference);
    if (result.status === 'success') {
      await checkoutWebhookService.completeSession(tenantId, session.reference, {
        type: 'charge.success', reference: session.reference, amountKobo: result.amountKobo, paidAt: result.paidAt, raw: result.raw,
      });
      session = await get({ tenantId, sessionId });
    }
  }

  return session;
}

/** Public-side lookup by session id alone (no tenant scoping — the
 * hosted page and inbound webhook are reached by anonymous customers
 * and providers, never a tenant-scoped credential). */
async function getPublic(sessionId) {
  const session = await prisma.checkoutSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new CheckoutSessionNotFoundError(sessionId);
  return session;
}

async function getAndSyncPublic(sessionId) {
  const session = await getPublic(sessionId);
  return getAndSync({ tenantId: session.tenantId, sessionId });
}

async function cancel({ tenantId, sessionId }) {
  const session = await get({ tenantId, sessionId });
  if (session.status !== 'pending' && session.status !== 'processing') {
    throw new CheckoutSessionNotCancellableError(sessionId, session.status);
  }
  return prisma.checkoutSession.update({ where: { id: session.id }, data: { status: 'cancelled' } });
}

module.exports = { create, get, getAndSync, getPublic, getAndSyncPublic, cancel };
