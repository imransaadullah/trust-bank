// Dual-approval on the concrete gaps Phase 2.5 exists to close — see
// ApprovalRequest's schema comment. Role checks live here, not in the
// route layer: which role can request/approve depends on the actionType
// (data, not the route path), so a single static requireStaffSession({
// roles }) gate can't express it the way it can for e.g. branches.js.
const prisma = require('../db/prismaClient');
const backendExecutor = require('./backendExecutor');
const {
  ApprovalRequestNotFoundError, InvalidActionTypeError, ForbiddenActionRoleError,
  SelfApprovalError, ApprovalNotPendingError, ApprovalNotFailedError, ExecutionFailedError,
} = require('../utils/errors');

// requestRoles/approveRoles are independent of self-approval, which is
// enforced separately (approve()) regardless of role — two people with
// the same role can still check each other; the same person never can.
const PERMISSIONS = {
  COMPLIANCE_CASE_REVIEW: {
    requestRoles: ['compliance_officer', 'ops_admin'],
    approveRoles: ['compliance_officer', 'ops_admin'],
  },
  LEDGER_ADJUSTMENT: {
    requestRoles: ['branch_manager', 'ops_admin'],
    approveRoles: ['ops_admin'],
  },
  LEDGER_REVERSAL: {
    requestRoles: ['branch_manager', 'ops_admin'],
    approveRoles: ['ops_admin'],
  },
  // approveRoles is ops_admin-only here, unlike COMPLIANCE_CASE_REVIEW's
  // peer-reviewable set — a policy change affects every future decision
  // tenant-wide, not one case, so it warrants the same above-the-request
  // sign-off the ledger actions use, not compliance-peer review.
  COMPLIANCE_KYC_POLICY_PUBLISH: {
    requestRoles: ['compliance_officer', 'ops_admin'],
    approveRoles: ['ops_admin'],
  },
  COMPLIANCE_DEVICE_POLICY_PUBLISH: {
    requestRoles: ['compliance_officer', 'ops_admin'],
    approveRoles: ['ops_admin'],
  },
  COMPLIANCE_MONITORING_POLICY_PUBLISH: {
    requestRoles: ['compliance_officer', 'ops_admin'],
    approveRoles: ['ops_admin'],
  },
  // Staff-discretionary release of funds based on a credit judgment —
  // the architecture doc's own trigger for maker-checker, and the
  // concrete reason Phase 2.5 was sequenced before Phase 3. Origination
  // itself is NOT maker-checker (see routes/loans.js) — only disbursement.
  LOAN_DISBURSEMENT: {
    requestRoles: ['loan_officer', 'credit_manager'],
    approveRoles: ['credit_manager'],
  },
  COMPLIANCE_LOAN_ELIGIBILITY_POLICY_PUBLISH: {
    requestRoles: ['credit_manager', 'ops_admin'],
    approveRoles: ['ops_admin'],
  },
};

function assertValidActionType(actionType) {
  if (!PERMISSIONS[actionType]) {
    throw new InvalidActionTypeError(actionType, Object.keys(PERMISSIONS));
  }
}

async function request({ tenantId, actionType, payload, requester }) {
  assertValidActionType(actionType);
  if (!PERMISSIONS[actionType].requestRoles.includes(requester.role)) {
    throw new ForbiddenActionRoleError(actionType, PERMISSIONS[actionType].requestRoles);
  }
  return prisma.approvalRequest.create({
    data: { tenantId, actionType, payload, requestedById: requester.id },
  });
}

async function list({ tenantId, status }) {
  return prisma.approvalRequest.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    orderBy: { requestedAt: 'desc' },
  });
}

async function get({ tenantId, id }) {
  const row = await prisma.approvalRequest.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApprovalRequestNotFoundError(id);
  return row;
}

async function reject({ tenantId, id, approver, reason }) {
  const row = await get({ tenantId, id });
  if (row.status !== 'pending') throw new ApprovalNotPendingError(id, row.status);
  if (!PERMISSIONS[row.actionType].approveRoles.includes(approver.role)) {
    throw new ForbiddenActionRoleError(row.actionType, PERMISSIONS[row.actionType].approveRoles);
  }
  // Self-rejection (withdrawing your own request) is fine — the safe
  // direction, nothing executes. Only self-*approval* is forbidden.
  return prisma.approvalRequest.update({
    where: { id },
    data: { status: 'rejected', approvedById: approver.id, approvedAt: new Date(), rejectionReason: reason },
  });
}

async function approve({ tenantId, id, approver }) {
  const row = await get({ tenantId, id });
  if (row.status !== 'pending') throw new ApprovalNotPendingError(id, row.status);
  if (!PERMISSIONS[row.actionType].approveRoles.includes(approver.role)) {
    throw new ForbiddenActionRoleError(row.actionType, PERMISSIONS[row.actionType].approveRoles);
  }
  if (row.requestedById === approver.id) throw new SelfApprovalError();

  await prisma.approvalRequest.update({
    where: { id },
    data: { status: 'approved', approvedById: approver.id, approvedAt: new Date() },
  });

  return runExecution({ tenantId, row: { ...row, status: 'approved' }, approver });
}

async function retryExecution({ tenantId, id, approver }) {
  const row = await get({ tenantId, id });
  if (row.status !== 'failed') throw new ApprovalNotFailedError(id, row.status);
  if (!PERMISSIONS[row.actionType].approveRoles.includes(approver.role)) {
    throw new ForbiddenActionRoleError(row.actionType, PERMISSIONS[row.actionType].approveRoles);
  }
  return runExecution({ tenantId, row, approver });
}

async function runExecution({ tenantId, row, approver }) {
  const payload = buildExecutionPayload(row, approver);
  try {
    const result = await backendExecutor.execute(row.actionType, tenantId, payload);
    return prisma.approvalRequest.update({
      where: { id: row.id },
      data: { status: 'executed', executedAt: new Date(), executionResult: result, executionError: null },
    });
  } catch (err) {
    const message = (err.response && err.response.data && err.response.data.error) || err.message;
    await prisma.approvalRequest.update({
      where: { id: row.id },
      data: { status: 'failed', executionError: message },
    });
    throw new ExecutionFailedError(message);
  }
}

// The approver's real, session-verified identity overrides whatever the
// maker put in the payload for reviewedBy — the whole point of this
// phase: Compliance's case-review route used to trust a free-text,
// caller-supplied string with no real identity behind it.
function buildExecutionPayload(row, approver) {
  if (row.actionType === 'COMPLIANCE_CASE_REVIEW') {
    return { ...row.payload, reviewedBy: approver.email };
  }
  return row.payload;
}

module.exports = {
  PERMISSIONS, assertValidActionType, request, list, get, approve, reject, retryExecution,
};
