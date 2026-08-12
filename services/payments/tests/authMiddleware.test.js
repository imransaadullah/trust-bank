// Integration test against a real Postgres and the actual Express app —
// see credentialService.test.js's header for the general pattern. This
// file specifically covers the bug SERVICE_CREDENTIAL_MODEL.md was
// written to fix: the old single shared secret meant any caller could act
// as any tenant just by supplying a different :tenantId in the URL.
const { randomUUID } = require('crypto');

let prisma;
let credentialService;
let request;
let app;

beforeAll(() => {
  process.env.LEDGER_SERVICE_URL = process.env.LEDGER_SERVICE_URL || 'http://localhost:1';
  process.env.LEDGER_API_KEY = process.env.LEDGER_API_KEY || 'unused-in-this-file';
  if (!process.env.DATABASE_URL) return;
  prisma = require('../src/db/prismaClient');
  credentialService = require('../src/services/credentialService');
  request = require('supertest');
  app = require('../src/app')();
});

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
});

const maybeTest = process.env.DATABASE_URL ? test : test.skip;

maybeTest('a valid operate token is accepted on an operate route', async () => {
  const tenantId = randomUUID();
  const { token } = await credentialService.issue({ tenantId, label: 'test', scope: 'operate' });

  const res = await request(app)
    .get(`/v1/tenants/${tenantId}/accounts/nobody`)
    .set('Authorization', `Bearer ${token}`);

  // 404 (no such account) proves auth passed — 401/403 would mean it didn't.
  expect(res.status).not.toBe(401);
  expect(res.status).not.toBe(403);
});

maybeTest('an invalid token is rejected with 401', async () => {
  const res = await request(app)
    .get(`/v1/tenants/${randomUUID()}/accounts/nobody`)
    .set('Authorization', 'Bearer garbage');
  expect(res.status).toBe(401);
});

maybeTest('a revoked token is rejected with 401', async () => {
  const tenantId = randomUUID();
  const { credential, token } = await credentialService.issue({ tenantId, label: 'test', scope: 'operate' });
  await credentialService.revoke({ tenantId, credentialId: credential.id });

  const res = await request(app)
    .get(`/v1/tenants/${tenantId}/accounts/nobody`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(401);
});

maybeTest('an operate-scope token is rejected on an admin route', async () => {
  const tenantId = randomUUID();
  const { token } = await credentialService.issue({ tenantId, label: 'test', scope: 'operate' });

  const res = await request(app)
    .get(`/v1/tenants/${tenantId}/credentials`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(403);
});

// The actual regression test for the bug this pass exists to fix.
maybeTest('a tenant-A credential is rejected when the URL claims tenant B', async () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const { token } = await credentialService.issue({ tenantId: tenantA, label: 'test', scope: 'operate' });

  const res = await request(app)
    .get(`/v1/tenants/${tenantB}/accounts/nobody`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(403);
});

if (!process.env.DATABASE_URL) {
  test.skip('DATABASE_URL not set — skipping authMiddleware integration tests', () => {});
}
