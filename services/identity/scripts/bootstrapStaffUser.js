// Creates the first staff user for a tenant — same chicken-and-egg fix as
// every other service's bootstrap script (services/gateway/scripts/
// bootstrapKey.js, services/compliance's equivalent): there's no staff
// session to authenticate a "create a staff user" API call with until one
// exists. Run once per tenant by a human with direct DB access, or by
// deploy/provision-tenant.sh.
//
//   node scripts/bootstrapStaffUser.js --tenant-id <id> --email ops@bank.example --role ops_admin
const crypto = require('crypto');
const prisma = require('../src/db/prismaClient');
const staffUserService = require('../src/services/staffUserService');

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
  const email = getArg('email');
  const role = getArg('role', false) || 'ops_admin';
  const branchId = getArg('branch-id', false);

  // A real, high-entropy temporary password — not a placeholder the
  // operator is expected to guess or rely on for long. The staff member
  // logs in with it once, then still has to enroll MFA before they ever
  // get a real session (see src/routes/auth.js) — there is no password
  // -only path to access, temp or otherwise.
  const temporaryPassword = crypto.randomBytes(18).toString('base64url');

  const staff = await staffUserService.create({ tenantId, email, password: temporaryPassword, role, branchId });
  console.log(`Created staff user ${staff.id} (${staff.email}, role=${staff.role})`);
  console.log(`Temporary password (shown once, store it now — it cannot be retrieved again):\n\n  ${temporaryPassword}\n`);
  console.log('This account still has to enroll MFA on first login (POST /v1/login -> /v1/mfa/enroll -> /v1/mfa/enroll/confirm) before it gets a real session.');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
