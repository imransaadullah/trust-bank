// Integration tests against a real Postgres — see services/ledger's
// README for the general pattern this repo uses. Point DATABASE_URL at
// a migrated database (`npx prisma migrate deploy`); tests skip cleanly
// if it's unset.
const { randomUUID } = require('crypto');

let prisma;
let policyService;

beforeAll(() => {
  if (!process.env.DATABASE_URL) return;
  prisma = require('../src/db/prismaClient');
  policyService = require('../src/services/policyService');
});

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
});

const maybeTest = process.env.DATABASE_URL ? test : test.skip;

describe('policyService versioning', () => {
  maybeTest('publishing increments the version and getCurrentKYCPolicy picks the latest effective one', async () => {
    const tenantId = randomUUID();
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60 * 60 * 1000);

    const v1 = await policyService.publishKYCPolicy({
      tenantId, jurisdiction: 'NG', tier: 1, requiredVerifications: ['bvn_or_nin'],
      dailyLimitKobo: 30_000_00, singleTxnLimitKobo: 30_000_00, effectiveFrom: past,
    });
    expect(v1.version).toBe(1);

    const v2 = await policyService.publishKYCPolicy({
      tenantId, jurisdiction: 'NG', tier: 1, requiredVerifications: ['bvn_or_nin'],
      dailyLimitKobo: 50_000_00, singleTxnLimitKobo: 50_000_00, effectiveFrom: future,
    });
    expect(v2.version).toBe(2);

    const current = await policyService.getCurrentKYCPolicy(tenantId, 'NG', 1);
    expect(current.version).toBe(1); // v2 isn't effective yet
    expect(current.dailyLimitKobo).toBe(30_000_00);

    const asOfFuture = await policyService.getCurrentKYCPolicy(tenantId, 'NG', 1, new Date(Date.now() + 2 * 60 * 60 * 1000));
    expect(asOfFuture.version).toBe(2);
    expect(asOfFuture.dailyLimitKobo).toBe(50_000_00);
  });

  maybeTest('getCurrentKYCPolicy throws NoPolicyConfiguredError when nothing is published', async () => {
    const tenantId = randomUUID();
    await expect(policyService.getCurrentKYCPolicy(tenantId, 'NG', 1)).rejects.toThrow('No KYC tier 1 policy configured');
  });

  maybeTest('device policy versioning follows the same rule', async () => {
    const tenantId = randomUUID();
    await policyService.publishDevicePolicy({
      tenantId, jurisdiction: 'NG', newDeviceCooldownHours: 24, newDeviceLimitKobo: 20_000_00,
      effectiveFrom: new Date(Date.now() - 60_000),
    });
    const current = await policyService.getCurrentDevicePolicy(tenantId, 'NG');
    expect(current.newDeviceCooldownHours).toBe(24);
    expect(current.newDeviceLimitKobo).toBe(20_000_00);
  });
});

if (!process.env.DATABASE_URL) {
  test.skip('DATABASE_URL not set — skipping policyService integration tests', () => {});
}
