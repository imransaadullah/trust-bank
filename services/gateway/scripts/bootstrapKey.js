// Issues the first admin-tier key for a tenant — the chicken-and-egg fix,
// since issuing a key normally requires an admin key you don't have yet.
// Same pattern as services/compliance's scripts/bootstrapKey.js. Run once
// per tenant by a human, or by deploy/provision-tenant.sh.
//
//   node scripts/bootstrapKey.js --tenant-id <id> --scope admin --label ops-bootstrap
const prisma = require('../src/db/prismaClient');
const apiKeyService = require('../src/services/apiKeyService');

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
  const tier = getArg('scope', false) || 'admin';
  const label = getArg('label', false) || 'bootstrap';
  if (tier !== 'admin') {
    throw new Error("bootstrapKey.js only issues 'admin' tier — sandbox/production keys go through POST /v1/tenants/:id/api-keys once an admin key exists");
  }

  const { apiKey, token } = await apiKeyService.issue({ tenantId, label, tier });
  console.log(`Issued API key ${apiKey.id} (tier=${apiKey.tier}, label="${apiKey.label}")`);
  console.log(`Token (shown once, store it now — it cannot be retrieved again):\n\n  ${token}\n`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
