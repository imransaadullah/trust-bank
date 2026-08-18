const prisma = require('../db/prismaClient');
const { BranchNotFoundError } = require('../utils/errors');

async function create({ tenantId, code, name }) {
  return prisma.branch.create({ data: { tenantId, code, name } });
}

async function list({ tenantId }) {
  return prisma.branch.findMany({ where: { tenantId }, orderBy: { code: 'asc' } });
}

async function get({ tenantId, branchId }) {
  const branch = await prisma.branch.findFirst({ where: { id: branchId, tenantId } });
  if (!branch) throw new BranchNotFoundError(branchId);
  return branch;
}

module.exports = { create, list, get };
