// Maps a real tenant to its synthetic sandbox twin — see SandboxTenant's
// schema comment. Registered once at onboarding time
// (deploy/provision-tenant.sh's provision_sandbox_twin), resolved on
// every sandbox-tier request (src/middleware/resolveEffectiveTenant.js).
const prisma = require('../db/prismaClient');
const { SandboxNotProvisionedError } = require('../utils/errors');

/** @returns {Promise<string>} the sandbox tenant id twinned to realTenantId */
async function resolve(realTenantId) {
  const row = await prisma.sandboxTenant.findUnique({ where: { realTenantId } });
  if (!row) throw new SandboxNotProvisionedError(realTenantId);
  return row.sandboxTenantId;
}

async function register({ realTenantId, sandboxTenantId }) {
  return prisma.sandboxTenant.upsert({
    where: { realTenantId },
    create: { realTenantId, sandboxTenantId },
    update: { sandboxTenantId },
  });
}

async function get(realTenantId) {
  return prisma.sandboxTenant.findUnique({ where: { realTenantId } });
}

module.exports = { resolve, register, get };
