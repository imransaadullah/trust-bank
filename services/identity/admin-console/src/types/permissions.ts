// A hand-mirrored copy of services/identity/src/services/approvalService.js's
// own PERMISSIONS map — this is a separate npm project with no access to
// identity's server code, so this can't be a live import. Used ONLY to
// decide which buttons/forms render; the server is the real, sole gate
// (approvalService.js re-checks every role/self-approval rule on every
// call regardless of what the client sends). If the two ever drift, the
// worst case is a button that's shown-but-403s or hidden-but-would-have-
// worked — never a security gap, since nothing here is trusted.
import type { ActionType, StaffRole } from './api';

export const PERMISSIONS: Record<ActionType, { requestRoles: StaffRole[]; approveRoles: StaffRole[] }> = {
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
  LOAN_DISBURSEMENT: {
    requestRoles: ['loan_officer', 'credit_manager'],
    approveRoles: ['credit_manager'],
  },
  COMPLIANCE_LOAN_ELIGIBILITY_POLICY_PUBLISH: {
    requestRoles: ['credit_manager', 'ops_admin'],
    approveRoles: ['ops_admin'],
  },
};

export const ACTION_TYPES = Object.keys(PERMISSIONS) as ActionType[];
