// A tenant's own merchant customer. Merchant.id doubles as the Ledger's
// externalCustomerId (see prisma/schema.prisma's own comment) — the
// Ledger account is opened FIRST, before any local row is written, so a
// failed Ledger call never leaves a merchant half-onboarded (a local
// row with no real wallet behind it).
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const prisma = require('../db/prismaClient');
const { encryptJSON, decryptJSON } = require('../crypto/tenantSecrets');
const ledgerClient = require('./ledgerClient');
const { MerchantNotFoundError } = require('../utils/errors');

async function create({ tenantId, name, email, webhookUrl }) {
  const id = uuidv4();
  await ledgerClient.openAccount(tenantId, { externalCustomerId: id, productType: 'wallet', currency: 'NGN' });

  const webhookSecret = crypto.randomBytes(32).toString('hex');
  const encryptedWebhookSecret = encryptJSON({ secret: webhookSecret });

  const merchant = await prisma.merchant.create({
    data: { id, tenantId, name, email, webhookUrl, encryptedWebhookSecret },
  });
  return { ...merchant, webhookSecret };
}

/** GET returns the decrypted webhook secret every time — unlike a bearer
 * API credential, this is meant to be re-readable indefinitely, the same
 * way Paystack's own webhook secret sits visibly in a dashboard. */
async function get({ tenantId, merchantId }) {
  const merchant = await prisma.merchant.findFirst({ where: { id: merchantId, tenantId } });
  if (!merchant) throw new MerchantNotFoundError(merchantId);
  return { ...merchant, webhookSecret: decryptJSON(merchant.encryptedWebhookSecret).secret };
}

async function list({ tenantId }) {
  return prisma.merchant.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, tenantId: true, name: true, email: true, webhookUrl: true, status: true, createdAt: true, updatedAt: true },
  });
}

async function requireExists({ tenantId, merchantId }) {
  const merchant = await prisma.merchant.findFirst({ where: { id: merchantId, tenantId } });
  if (!merchant) throw new MerchantNotFoundError(merchantId);
  return merchant;
}

/** Mints a brand-new secret, replacing the old one outright — same
 * "re-readable indefinitely" convention as get() above, not a shown-once
 * credential, so there's no separate reveal step beyond the response
 * here and a subsequent GET. */
async function rotateWebhookSecret({ tenantId, merchantId }) {
  await requireExists({ tenantId, merchantId });
  const webhookSecret = crypto.randomBytes(32).toString('hex');
  const encryptedWebhookSecret = encryptJSON({ secret: webhookSecret });
  const merchant = await prisma.merchant.update({ where: { id: merchantId }, data: { encryptedWebhookSecret } });
  return { ...merchant, webhookSecret };
}

/** The real gap named at the end of the merchant-dashboard slice — no
 * route anywhere let this change after creation. Either the merchant
 * themselves or the tenant (see resolveMerchantScope on the route) can
 * call this; same no-validation-beyond-non-empty simplicity create()
 * already uses for this field. */
async function updateWebhookUrl({ tenantId, merchantId, webhookUrl }) {
  await requireExists({ tenantId, merchantId });
  const merchant = await prisma.merchant.update({ where: { id: merchantId }, data: { webhookUrl } });
  return { ...merchant, webhookSecret: decryptJSON(merchant.encryptedWebhookSecret).secret };
}

module.exports = { create, get, list, requireExists, rotateWebhookSecret, updateWebhookUrl };
