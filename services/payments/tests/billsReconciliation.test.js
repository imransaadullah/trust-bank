// Integration test against a real Postgres — see reconciliation.test.js's
// header for the general pattern; the provider's network call is faked
// via jest.spyOn on KudaBillsProvider.prototype.checkPurchaseStatus.
const { randomUUID } = require('crypto');

let prisma;
let billsConfigService;
let billsService;
let KudaBillsProvider;

beforeAll(() => {
  process.env.LEDGER_SERVICE_URL = process.env.LEDGER_SERVICE_URL || 'http://localhost:1';
  process.env.LEDGER_API_KEY = process.env.LEDGER_API_KEY || 'test-key';
  if (!process.env.DATABASE_URL) return;
  prisma = require('../src/db/prismaClient');
  billsConfigService = require('../src/services/billsConfigService');
  billsService = require('../src/services/billsService');
  ({ KudaBillsProvider } = require('../src/providers/kudaBillsProvider'));
});

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const maybeTest = process.env.DATABASE_URL ? test : test.skip;

async function seedTenantAndAttempt() {
  const tenantId = randomUUID();
  await billsConfigService.setConfig({
    tenantId, provider: 'kuda', credentials: { email: 'ops@trustpay.example', apiKey: 'fake-key' },
  });
  const attempt = await prisma.billPaymentAttempt.create({
    data: {
      tenantId, provider: 'kuda', providerRef: `BILL-${randomUUID()}`,
      externalCustomerId: 'customer-1', billerCode: 'biller-1', customerId: '08010000000',
      amount: 50000, status: 'pending', journalEntryId: randomUUID(),
    },
  });
  return { tenantId, attempt };
}

describe('billsService.reconcileBillAttempt', () => {
  maybeTest('resolves the attempt when checkPurchaseStatus confirms completion', async () => {
    jest.spyOn(KudaBillsProvider.prototype, 'checkPurchaseStatus').mockResolvedValue({ status: 'completed' });
    const { attempt } = await seedTenantAndAttempt();

    const result = await billsService.reconcileBillAttempt(attempt);
    expect(result.action).toBe('resolved');

    const updated = await prisma.billPaymentAttempt.findUnique({ where: { id: attempt.id } });
    expect(updated.status).toBe('resolved');
  });

  maybeTest('reverses and marks failed when checkPurchaseStatus confirms failure', async () => {
    jest.spyOn(KudaBillsProvider.prototype, 'checkPurchaseStatus')
      .mockResolvedValue({ status: 'failed', failureReason: 'Biller rejected the request' });
    const { attempt } = await seedTenantAndAttempt();

    const result = await billsService.reconcileBillAttempt(attempt);
    expect(result.action).toBe('reversed');

    const updated = await prisma.billPaymentAttempt.findUnique({ where: { id: attempt.id } });
    expect(updated.status).toBe('failed');
    expect(updated.failureReason).toBe('Biller rejected the request');
  });

  maybeTest('leaves the attempt pending when still processing', async () => {
    jest.spyOn(KudaBillsProvider.prototype, 'checkPurchaseStatus').mockResolvedValue({ status: 'processing' });
    const { attempt } = await seedTenantAndAttempt();

    const result = await billsService.reconcileBillAttempt(attempt);
    expect(result.action).toBe('still-pending');

    const updated = await prisma.billPaymentAttempt.findUnique({ where: { id: attempt.id } });
    expect(updated.status).toBe('pending');
  });

  maybeTest('skips gracefully when the provider call itself fails', async () => {
    jest.spyOn(KudaBillsProvider.prototype, 'checkPurchaseStatus').mockRejectedValue(new Error('network error'));
    const { attempt } = await seedTenantAndAttempt();

    const result = await billsService.reconcileBillAttempt(attempt);
    expect(result.action).toBe('skipped');

    const updated = await prisma.billPaymentAttempt.findUnique({ where: { id: attempt.id } });
    expect(updated.status).toBe('pending');
  });
});

describe('billsService.autoRefundStaleBillAttempt', () => {
  maybeTest('marks the attempt failed regardless of provider state', async () => {
    const { attempt } = await seedTenantAndAttempt();

    const result = await billsService.autoRefundStaleBillAttempt(attempt, 'Auto-refunded: exceeded SLA');
    expect(result.action).toBe('auto-refunded');

    const updated = await prisma.billPaymentAttempt.findUnique({ where: { id: attempt.id } });
    expect(updated.status).toBe('failed');
    expect(updated.failureReason).toBe('Auto-refunded: exceeded SLA');
  });
});

describe('billsReconciliationService.reconcileTenantBills', () => {
  maybeTest('auto-refunds a still-processing attempt past the SLA window', async () => {
    const billsReconciliationService = require('../src/services/billsReconciliationService');
    jest.spyOn(KudaBillsProvider.prototype, 'checkPurchaseStatus').mockResolvedValue({ status: 'processing' });

    const { tenantId, attempt } = await seedTenantAndAttempt();
    // Backdate creation so it's both "stale" and past the auto-refund SLA.
    await prisma.billPaymentAttempt.update({
      where: { id: attempt.id }, data: { createdAt: new Date(Date.now() - 120 * 60_000) },
    });

    const results = await billsReconciliationService.reconcileTenantBills(tenantId, {
      staleMinutes: 15, autoRefundMinutes: 60,
    });

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('auto-refunded');

    const updated = await prisma.billPaymentAttempt.findUnique({ where: { id: attempt.id } });
    expect(updated.status).toBe('failed');
  });

  maybeTest('a bills-only tenant (no payment-rail config) is reconciled fine', async () => {
    const billsReconciliationService = require('../src/services/billsReconciliationService');
    jest.spyOn(KudaBillsProvider.prototype, 'checkPurchaseStatus').mockResolvedValue({ status: 'completed' });

    const { tenantId, attempt } = await seedTenantAndAttempt();
    await prisma.billPaymentAttempt.update({
      where: { id: attempt.id }, data: { createdAt: new Date(Date.now() - 30 * 60_000) },
    });

    const rows = await prisma.tenantProviderConfig.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(0);

    const results = await billsReconciliationService.reconcileTenantBills(tenantId, { staleMinutes: 15 });
    expect(results[0].action).toBe('resolved');
  });
});

if (!process.env.DATABASE_URL) {
  test.skip('DATABASE_URL not set — skipping bills reconciliation integration tests', () => {});
}
