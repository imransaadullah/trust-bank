// Integration test against a real Postgres — see reconciliation.test.js's
// header for the general pattern. Tests skip cleanly if DATABASE_URL is
// unset.
const { randomUUID } = require('crypto');
const crypto = require('crypto');

let prisma;
let credentialService;

beforeAll(() => {
  if (!process.env.DATABASE_URL) return;
  prisma = require('../src/db/prismaClient');
  credentialService = require('../src/services/credentialService');
});

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
});

const maybeTest = process.env.DATABASE_URL ? test : test.skip;

maybeTest('issue then verify round-trips to the same credential', async () => {
  const tenantId = randomUUID();
  const { credential, token } = await credentialService.issue({ tenantId, label: 'test', scope: 'operate' });
  expect(token).toBeTruthy();

  const verified = await credentialService.verify(token);
  expect(verified.id).toBe(credential.id);
  expect(verified.scope).toBe('operate');
});

maybeTest('the plaintext token is never persisted — only its sha256 hash', async () => {
  const tenantId = randomUUID();
  const { token } = await credentialService.issue({ tenantId, label: 'test', scope: 'operate' });

  const row = await prisma.apiCredential.findFirst({ where: { tenantId } });
  expect(row.hashedToken).not.toBe(token);
  expect(row.hashedToken).toBe(crypto.createHash('sha256').update(token).digest('hex'));
});

maybeTest('verify rejects an unknown token', async () => {
  const result = await credentialService.verify('pay_live_' + '0'.repeat(64));
  expect(result).toBeNull();
});

maybeTest('verify rejects a revoked token', async () => {
  const tenantId = randomUUID();
  const { credential, token } = await credentialService.issue({ tenantId, label: 'test', scope: 'operate' });
  await credentialService.revoke({ tenantId, credentialId: credential.id });

  const result = await credentialService.verify(token);
  expect(result).toBeNull();
});

maybeTest('revoke on an unknown credential throws CREDENTIAL_NOT_FOUND', async () => {
  const tenantId = randomUUID();
  await expect(
    credentialService.revoke({ tenantId, credentialId: randomUUID() }),
  ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
});

maybeTest('list is scoped to the tenant, not global', async () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  await credentialService.issue({ tenantId: tenantA, label: 'a-1', scope: 'operate' });
  await credentialService.issue({ tenantId: tenantB, label: 'b-1', scope: 'operate' });

  const listA = await credentialService.list({ tenantId: tenantA });
  expect(listA).toHaveLength(1);
  expect(listA[0].label).toBe('a-1');
});

maybeTest('issue rejects an invalid scope', async () => {
  await expect(
    credentialService.issue({ tenantId: randomUUID(), label: 'test', scope: 'superadmin' }),
  ).rejects.toThrow(/scope must be/);
});

if (!process.env.DATABASE_URL) {
  test.skip('DATABASE_URL not set — skipping credentialService integration tests', () => {});
}
