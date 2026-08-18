// Stores this tenant's Ledger/Compliance operate credential — needed
// before this service can actually execute an approved action. A script,
// not an HTTP admin route: identity's entire HTTP surface is staff-
// session-gated (a logged-in human), and this is fundamentally a
// machine/bootstrap operation — same tension already resolved for the
// very first staff user (bootstrapStaffUser.js, direct DB access, no
// HTTP). Run once per tenant per service by a human, or by
// deploy/provision-tenant.sh.
//
//   node scripts/storeTenantBackendCredential.js --tenant-id <id> --service ledger --token <token>
const prisma = require('../src/db/prismaClient');
const tenantBackendCredentialService = require('../src/services/tenantBackendCredentialService');

function getArg(name, required = true) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || !process.argv[idx + 1]) {
    if (required) throw new Error(`--${name} is required`);
    return undefined;
  }
  return process.argv[idx + 1];
}

async function main() {
  const tenantId = getArg('tenant-id');
  const service = getArg('service');
  const token = getArg('token');

  await tenantBackendCredentialService.store({ tenantId, service, token });
  console.log(`Stored identity's ${service} credential for tenant ${tenantId}.`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
