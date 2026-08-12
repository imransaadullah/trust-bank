// Issues the first admin credential for a tenant — the chicken-and-egg
// fix, since issuing a credential normally requires an admin credential
// you don't have yet. Run once per tenant by a human.
//
//   node scripts/bootstrapKey.js --tenant-id <id> --scope admin --label ops-bootstrap
const prisma = require('../src/db/prismaClient');
const credentialService = require('../src/services/credentialService');

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
  const scope = getArg('scope');
  const label = getArg('label', false) || 'bootstrap';
  if (!['admin', 'operate'].includes(scope)) {
    throw new Error("--scope must be 'admin' or 'operate'");
  }

  const { credential, token } = await credentialService.issue({ tenantId, label, scope });
  console.log(`Issued credential ${credential.id} (scope=${credential.scope}, label="${credential.label}")`);
  console.log(`Token (shown once, store it now — it cannot be retrieved again):\n\n  ${token}\n`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
