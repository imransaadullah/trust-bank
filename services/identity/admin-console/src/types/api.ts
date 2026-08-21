// Mirrors the exact shapes returned by services/identity's own routes —
// see each route file for the source of truth. Kept as a single file
// since this console talks to one backend with ~15 endpoints; no
// codegen, hand-maintained.

export type StaffRole = 'teller' | 'branch_manager' | 'loan_officer' | 'ops_admin' | 'compliance_officer' | 'credit_manager';

export const TENANT_WIDE_ROLES: StaffRole[] = ['ops_admin', 'compliance_officer', 'credit_manager'];

// GET /v1/me
export interface Me {
  id: string;
  tenantId: string;
  email: string;
  role: StaffRole;
  branchId: string | null;
}

// GET/POST /v1/branches
export interface Branch {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  status: string; // 'active' | 'closed' — no server-side filter, see branches.ts
  createdAt: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export type ActionType =
  | 'COMPLIANCE_CASE_REVIEW'
  | 'LEDGER_ADJUSTMENT'
  | 'LEDGER_REVERSAL'
  | 'COMPLIANCE_KYC_POLICY_PUBLISH'
  | 'COMPLIANCE_DEVICE_POLICY_PUBLISH'
  | 'COMPLIANCE_MONITORING_POLICY_PUBLISH'
  | 'LOAN_DISBURSEMENT'
  | 'COMPLIANCE_LOAN_ELIGIBILITY_POLICY_PUBLISH';

// ApprovalRequest — services/identity/prisma/schema.prisma
export interface Approval {
  id: string;
  tenantId: string;
  actionType: ActionType;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  requestedById: string;
  requestedAt: string;
  approvedById: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  executedAt: string | null;
  executionResult: Record<string, unknown> | null;
  executionError: string | null;
}

// POST /v1/accounts response — the Ledger's own accountResponse shape
export interface LedgerAccount {
  id: string;
  accountNumber: string;
  externalCustomerId: string;
  branchId: string | null;
  productType: string;
  status: string;
  kycTier?: number;
}

// The Compliance decisionService's LoanEligibilityDecision shape,
// returned as `data` on a 422 LOAN_NOT_ELIGIBLE response.
export interface LoanEligibilityDecision {
  allowed: boolean;
  reason?: string;
  maxLoanAmountKobo?: number;
  interestRateAnnualBps?: number;
  maxTenorDays?: number;
  policyVersion?: number;
}

// POST /v1/loans response — a PENDING loan account
export interface LoanAccount {
  id: string;
  externalCustomerId: string;
  principalKobo: number;
  tenorDays: number;
  annualRateBps: number;
  status: string;
  branchId: string | null;
}

// ComplianceCase — services/compliance's own model, proxied via
// GET /v1/compliance-cases
export interface ComplianceCase {
  id: string;
  tenantId: string;
  userId: string;
  caseType: string;
  severity: string;
  matchedRules: unknown;
  context: unknown;
  status: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

export interface ApiErrorBody {
  success: false;
  error: string;
  code?: string;
}

export interface ApiSuccessBody<T> {
  success: true;
  data: T;
}
