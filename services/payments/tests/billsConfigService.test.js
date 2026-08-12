// Integration test against a real Postgres — see reconciliation.test.js's
// header for the general pattern. Tests skip cleanly if DATABASE_URL is
// unset.
const { randomUUID } = require('crypto');

let prisma;
let billsConfigService;

beforeAll(() => {
  if (!process.env.DATABASE_URL) return;
  prisma = require('../src/db/prismaClient');
  billsConfigService = require('../src/services/billsConfigService');
});

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
});

const maybeTest = process.env.DATABASE_URL ? test : test.skip;

maybeTest('setConfig then getConfigByTenantId round-trips the provider and decrypted credentials', async () => {
  const tenantId = randomUUID();
  await billsConfigService.setConfig({
    tenantId, provider: 'kuda', credentials: { email: 'ops@trustpay.example', apiKey: 'fake-key' },
  });

  const config = await billsConfigService.getConfigByTenantId(tenantId);
  expect(config.provider).toBe('kuda');
  expect(config.encryptedCredentials).not.toContain('fake-key');
});

maybeTest('getProviderForTenant returns a ready-to-use, correctly-typed provider', async () => {
  const { KudaBillsProvider } = require('../src/providers/kudaBillsProvider');
  const tenantId = randomUUID();
  await billsConfigService.setConfig({
    tenantId, provider: 'kuda', credentials: { email: 'ops@trustpay.example', apiKey: 'fake-key' },
  });

  const { provider } = await billsConfigService.getProviderForTenant(tenantId);
  expect(provider).toBeInstanceOf(KudaBillsProvider);
});

maybeTest('a tenant with only a bills config (no payment-rail config) works fine', async () => {
  const tenantId = randomUUID();
  await billsConfigService.setConfig({
    tenantId, provider: 'vtpass', credentials: { apiKey: 'x', secretKey: 'y' },
  });
  const config = await billsConfigService.getConfigByTenantId(tenantId);
  expect(config.provider).toBe('vtpass');

  const rows = await prisma.tenantProviderConfig.findMany({ where: { tenantId } });
  expect(rows).toHaveLength(0);
});

maybeTest('getConfigByTenantId throws TenantNotConfiguredError for an unconfigured tenant', async () => {
  await expect(billsConfigService.getConfigByTenantId(randomUUID())).rejects.toMatchObject({
    code: 'TENANT_NOT_CONFIGURED',
  });
});

if (!process.env.DATABASE_URL) {
  test.skip('DATABASE_URL not set — skipping billsConfigService integration tests', () => {});
}
