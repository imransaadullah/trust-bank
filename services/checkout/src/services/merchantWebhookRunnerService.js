// A Node port of services/ledger/internal/outbox/outbox.go's own
// claim/deliver/mark-result shape, per-MERCHANT instead of per-tenant
// (a tenant can have many merchants, each with its own webhookUrl).
// Same numbers outbox.go already uses: 5s poll, batch 20. No
// exponential backoff — linear retry only, the same accepted limitation
// outbox.go's own comment already names.
const { createHmac } = require('crypto');
const axios = require('axios');
const prisma = require('../db/prismaClient');
const config = require('../config');
const logger = require('../utils/logger');
const { decryptJSON } = require('../crypto/tenantSecrets');

async function claimBatch(batchSize) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id, tenant_id, merchant_id, checkout_session_id, event_type, payload, retry_count, max_retries
      FROM merchant_webhook_deliveries
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY created_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    await tx.$executeRaw`UPDATE merchant_webhook_deliveries SET status = 'processing' WHERE id = ANY(${ids})`;
    return rows;
  });
}

async function deliverOne(row) {
  const merchant = await prisma.merchant.findUnique({ where: { id: row.merchant_id } });
  if (!merchant || !merchant.webhookUrl) {
    // No destination configured — nothing to retry toward. Mark failed
    // immediately rather than burning retries against nothing.
    await prisma.merchantWebhookDelivery.update({
      where: { id: row.id },
      data: { status: 'failed', lastError: 'merchant has no webhookUrl configured' },
    });
    return;
  }

  const webhookSecret = decryptJSON(merchant.encryptedWebhookSecret).secret;
  const body = JSON.stringify(row.payload);
  const signature = createHmac('sha256', webhookSecret).update(body).digest('hex');

  try {
    await axios.post(merchant.webhookUrl, row.payload, {
      headers: { 'X-Checkout-Signature': `sha256=${signature}`, 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    await prisma.merchantWebhookDelivery.update({
      where: { id: row.id },
      data: { status: 'delivered', deliveredAt: new Date() },
    });
  } catch (err) {
    const nextRetryCount = row.retry_count + 1;
    const failed = nextRetryCount >= row.max_retries;
    await prisma.merchantWebhookDelivery.update({
      where: { id: row.id },
      data: {
        status: failed ? 'failed' : 'pending',
        retryCount: nextRetryCount,
        lastError: err.message,
        nextAttemptAt: new Date(),
      },
    });
  }
}

async function drainOnce() {
  const rows = await claimBatch(config.merchantWebhook.batchSize);
  for (const row of rows) {
    await deliverOne(row); // eslint-disable-line no-await-in-loop
  }
  return rows.length;
}

module.exports = { drainOnce, claimBatch, deliverOne };
