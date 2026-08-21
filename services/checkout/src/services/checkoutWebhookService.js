// Completes a checkout session — called from two places that both need
// the exact same safety guarantees: the real inbound provider webhook
// route, and the hosted page's own GET handler (checkoutSessionService's
// syncFromProviderIfNeeded), which covers the case where a customer's
// redirect-back lands before the webhook does.
const prisma = require('../db/prismaClient');
const ledgerClient = require('./ledgerClient');
const tenantCheckoutProviderConfigService = require('./tenantCheckoutProviderConfigService');
const { InvalidProviderError, WebhookVerificationError } = require('../utils/errors');
const logger = require('../utils/logger');

async function handleProviderWebhook(tenantSlug, providerName, rawBody, headers) {
  const { tenantId, provider } = await tenantCheckoutProviderConfigService.getProviderForTenantSlug(tenantSlug);
  if (provider.name !== providerName) {
    throw new InvalidProviderError(providerName);
  }
  if (!provider.verifyWebhookSignature(rawBody, headers)) {
    throw new WebhookVerificationError();
  }

  const eventBody = JSON.parse(rawBody.toString('utf8'));
  const event = provider.parseWebhookEvent(eventBody);
  if (event.type !== 'charge.success') {
    logger.warn(`[CheckoutWebhooks] unhandled event type: ${event.type}`, { tenantSlug });
    return { handled: false, reason: `unhandled event type: ${event.type}` };
  }

  return completeSession(tenantId, event.reference, event);
}

/**
 * pending -> processing -> paid (+ Ledger credit + merchant webhook
 * enqueued), or processing -> pending on a Ledger failure so a later
 * retry can complete it. The CAS below is what makes a duplicate
 * webhook, or a redirect-triggered verify racing the real webhook,
 * both safe: only one caller ever wins the pending -> processing move.
 * Without the revert-on-failure branch, a transient Ledger error would
 * strand the session 'processing' forever — no money moved, and no
 * future retry able to see it as still-completable.
 */
async function completeSession(tenantId, reference, event) {
  const claimed = await prisma.checkoutSession.updateMany({
    where: { tenantId, reference, status: 'pending' },
    data: { status: 'processing' },
  });
  if (claimed.count === 0) {
    return { handled: true, alreadyProcessed: true };
  }

  const session = await prisma.checkoutSession.findFirst({ where: { tenantId, reference } });
  try {
    const entry = await ledgerClient.confirmDeposit(tenantId, {
      externalCustomerId: session.merchantId,
      amount: session.amountKobo,
      providerRef: event.reference,
      reference: session.reference,
      idempotencyKey: `checkout:${session.id}`,
      description: `Checkout payment ${session.reference}`,
    });

    const paidAt = new Date();
    await prisma.$transaction([
      prisma.checkoutSession.update({
        where: { id: session.id },
        data: { status: 'paid', paidAt, providerRef: event.reference },
      }),
      prisma.merchantWebhookDelivery.upsert({
        where: { checkoutSessionId_eventType: { checkoutSessionId: session.id, eventType: 'checkout.session.completed' } },
        create: {
          tenantId,
          merchantId: session.merchantId,
          checkoutSessionId: session.id,
          eventType: 'checkout.session.completed',
          payload: {
            sessionId: session.id, reference: session.reference,
            amountKobo: session.amountKobo, paidAt: paidAt.toISOString(),
          },
        },
        update: {},
      }),
    ]);
    return { handled: true, journalEntryId: entry.id };
  } catch (err) {
    await prisma.checkoutSession.updateMany({ where: { id: session.id, status: 'processing' }, data: { status: 'pending' } });
    throw err;
  }
}

module.exports = { handleProviderWebhook, completeSession };
