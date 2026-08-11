// Integration test against a real Postgres (see paystackProvider.test.js's
// header for the general skip-if-unset pattern) — the DB side is real,
// only the provider's network call is faked (jest.spyOn on
// PaystackProvider.prototype.getTransferStatus), matching this repo's
// established "real DB, faked external network" testing style.
const { randomUUID } = require('crypto');

let prisma;
let tenantConfigService;
let settlementService;
let PaystackProvider;

beforeAll(() => {
  process.env.LEDGER_SERVICE_URL = process.env.LEDGER_SERVICE_URL || 'http://localhost:1';
  if (!process.env.DATABASE_URL) return;
  prisma = require('../src/db/prismaClient');
  tenantConfigService = require('../src/services/tenantConfigService');
  settlementService = require('../src/services/settlementService');
  ({ PaystackProvider } = require('../src/providers/paystack'));
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
  await tenantConfigService.setConfig({
    tenantId, tenantSlug: `recon-test-${tenantId.slice(0, 8)}`, provider: 'paystack',
    credentials: { secretKey: 'sk_test_fake', webhookSecret: 'whsec_fake' },
  });
  const attempt = await prisma.settlementAttempt.create({
    data: {
      tenantId, direction: 'outbound', provider: 'paystack', providerRef: `ref-${randomUUID()}`,
      externalCustomerId: 'customer-1', amount: 500000, status: 'pending',
      journalEntryId: randomUUID(),
    },
  });
  return { tenantId, attempt };
}

describe('settlementService.reconcileOutboundAttempt', () => {
  maybeTest('resolves the attempt when the provider confirms completion', async () => {
    jest.spyOn(PaystackProvider.prototype, 'getTransferStatus').mockResolvedValue({ status: 'completed' });
    const { attempt } = await seedTenantAndAttempt();

    const result = await settlementService.reconcileOutboundAttempt(attempt);
    expect(result.action).toBe('resolved');

    const updated = await prisma.settlementAttempt.findUnique({ where: { id: attempt.id } });
    expect(updated.status).toBe('resolved');
  });

  maybeTest('reverses and marks failed when the provider confirms failure', async () => {
    jest.spyOn(PaystackProvider.prototype, 'getTransferStatus')
      .mockResolvedValue({ status: 'failed', failureReason: 'insufficient pool balance' });
    const { attempt } = await seedTenantAndAttempt();

    const result = await settlementService.reconcileOutboundAttempt(attempt);
    expect(result.action).toBe('reversed');

    const updated = await prisma.settlementAttempt.findUnique({ where: { id: attempt.id } });
    expect(updated.status).toBe('failed');
    expect(updated.failureReason).toBe('insufficient pool balance');
  });

  maybeTest('leaves the attempt pending when the provider is still processing', async () => {
    jest.spyOn(PaystackProvider.prototype, 'getTransferStatus').mockResolvedValue({ status: 'processing' });
    const { attempt } = await seedTenantAndAttempt();

    const result = await settlementService.reconcileOutboundAttempt(attempt);
    expect(result.action).toBe('still-pending');

    const updated = await prisma.settlementAttempt.findUnique({ where: { id: attempt.id } });
    expect(updated.status).toBe('pending');
  });

  maybeTest('skips gracefully when the provider call itself fails', async () => {
    jest.spyOn(PaystackProvider.prototype, 'getTransferStatus').mockRejectedValue(new Error('network error'));
    const { attempt } = await seedTenantAndAttempt();

    const result = await settlementService.reconcileOutboundAttempt(attempt);
    expect(result.action).toBe('skipped');

    const updated = await prisma.settlementAttempt.findUnique({ where: { id: attempt.id } });
    expect(updated.status).toBe('pending');
  });
});

describe('settlementService.autoRefundStaleAttempt', () => {
  maybeTest('marks the attempt failed regardless of provider state', async () => {
    const { attempt } = await seedTenantAndAttempt();

    const result = await settlementService.autoRefundStaleAttempt(attempt, 'Auto-refunded: exceeded SLA');
    expect(result.action).toBe('auto-refunded');

    const updated = await prisma.settlementAttempt.findUnique({ where: { id: attempt.id } });
    expect(updated.status).toBe('failed');
    expect(updated.failureReason).toBe('Auto-refunded: exceeded SLA');
  });
});

if (!process.env.DATABASE_URL) {
  test.skip('DATABASE_URL not set — skipping reconciliation integration tests', () => {});
}
