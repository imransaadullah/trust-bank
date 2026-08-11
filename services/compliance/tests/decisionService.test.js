const { randomUUID } = require('crypto');

let prisma;
let policyService;
let decisionService;

beforeAll(() => {
  if (!process.env.DATABASE_URL) return;
  prisma = require('../src/db/prismaClient');
  policyService = require('../src/services/policyService');
  decisionService = require('../src/services/decisionService');
});

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
});

const maybeDescribe = process.env.DATABASE_URL ? describe : describe.skip;

async function seedTier1Policy(tenantId) {
  return policyService.publishKYCPolicy({
    tenantId, jurisdiction: 'NG', tier: 1, requiredVerifications: ['bvn_or_nin'],
    dailyLimitKobo: 30_000_00, singleTxnLimitKobo: 30_000_00, effectiveFrom: new Date(Date.now() - 1000),
  });
}

async function seedTier3Policy(tenantId) {
  return policyService.publishKYCPolicy({
    tenantId, jurisdiction: 'NG', tier: 3, requiredVerifications: ['beneficial_ownership'],
    dailyLimitKobo: null, singleTxnLimitKobo: null, effectiveFrom: new Date(Date.now() - 1000),
  });
}

async function seedDevicePolicy(tenantId) {
  return policyService.publishDevicePolicy({
    tenantId, jurisdiction: 'NG', newDeviceCooldownHours: 24, newDeviceLimitKobo: 20_000_00,
    effectiveFrom: new Date(Date.now() - 1000),
  });
}

maybeDescribe('decisionService.evaluateKYCTier', () => {
  test('allows a transaction within both single-txn and daily limits', async () => {
    const tenantId = randomUUID();
    await seedTier1Policy(tenantId);
    const decision = await decisionService.evaluateKYCTier({
      tenantId, jurisdiction: 'NG', tier: 1, amount: 10_000_00, amountTransactedTodayKobo: 0,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.policyVersion).toBe(1);
  });

  test('rejects a single transaction over the single-txn limit', async () => {
    const tenantId = randomUUID();
    await seedTier1Policy(tenantId);
    const decision = await decisionService.evaluateKYCTier({
      tenantId, jurisdiction: 'NG', tier: 1, amount: 30_001_00, amountTransactedTodayKobo: 0,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/single-transaction limit/);
  });

  test('rejects when today\'s spend plus this amount would exceed the daily limit', async () => {
    const tenantId = randomUUID();
    await seedTier1Policy(tenantId);
    const decision = await decisionService.evaluateKYCTier({
      tenantId, jurisdiction: 'NG', tier: 1, amount: 10_000_00, amountTransactedTodayKobo: 25_000_00,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/daily limit/);
  });

  test('Tier 3 (unlimited) allows a large transaction regardless of amount', async () => {
    const tenantId = randomUUID();
    await seedTier3Policy(tenantId);
    const decision = await decisionService.evaluateKYCTier({
      tenantId, jurisdiction: 'NG', tier: 3, amount: 50_000_000_00, amountTransactedTodayKobo: 0,
    });
    expect(decision.allowed).toBe(true);
  });
});

maybeDescribe('decisionService.evaluateDevice', () => {
  test('caps a brand-new device at the policy limit', async () => {
    const tenantId = randomUUID();
    await seedDevicePolicy(tenantId);
    const decision = await decisionService.evaluateDevice({
      tenantId, jurisdiction: 'NG', isNewDevice: true, amount: 25_000_00,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.capAppliedKobo).toBe(20_000_00);
  });

  test('allows a new device to transact within the cap', async () => {
    const tenantId = randomUUID();
    await seedDevicePolicy(tenantId);
    const decision = await decisionService.evaluateDevice({
      tenantId, jurisdiction: 'NG', isNewDevice: true, amount: 10_000_00,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.capAppliedKobo).toBe(20_000_00);
  });

  test('does not cap a device past its cooldown window, even for a large amount', async () => {
    const tenantId = randomUUID();
    await seedDevicePolicy(tenantId);
    const decision = await decisionService.evaluateDevice({
      tenantId, jurisdiction: 'NG', isNewDevice: false, deviceAgeHours: 48, amount: 1_000_000_00,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.capAppliedKobo).toBeUndefined();
  });

  test('still caps a device inside its cooldown window even if not flagged isNewDevice', async () => {
    const tenantId = randomUUID();
    await seedDevicePolicy(tenantId);
    const decision = await decisionService.evaluateDevice({
      tenantId, jurisdiction: 'NG', isNewDevice: false, deviceAgeHours: 2, amount: 25_000_00,
    });
    expect(decision.allowed).toBe(false);
  });
});

if (!process.env.DATABASE_URL) {
  test.skip('DATABASE_URL not set — skipping decisionService integration tests', () => {});
}
