// Executes an approved action against the real Ledger/Compliance
// endpoint, using this tenant's own stored operate credential. Mirrors
// services/gateway's backendProxy.js calling-convention handling exactly
// (Ledger: X-Tenant-Id header, raw JSON response; Compliance: tenant in
// the URL path, {success,data} envelope) — no circuit breaker here,
// unlike the gateway: this is low-volume, human-triggered traffic from
// an approval click, not a proxy absorbing arbitrary API load.
const axios = require('axios');
const config = require('../config');
const tenantBackendCredentialService = require('./tenantBackendCredentialService');

const BACKENDS = {
  ledger: { baseUrl: config.ledger.baseUrl, tenantVia: 'header' },
  compliance: { baseUrl: config.compliance.baseUrl, tenantVia: 'path' },
};

// One request shape per action type — path builder gets the effective
// tenantId (compliance needs it in the path), payload is forwarded
// unchanged (see ApprovalRequest's own schema comment on why).
const ACTIONS = {
  COMPLIANCE_CASE_REVIEW: {
    service: 'compliance',
    method: 'POST',
    path: (tenantId, payload) => `/v1/tenants/${tenantId}/compliance/cases/${payload.caseId}/review`,
  },
  LEDGER_ADJUSTMENT: {
    service: 'ledger',
    method: 'POST',
    path: () => '/v1/journal-entries',
  },
  LEDGER_REVERSAL: {
    service: 'ledger',
    method: 'POST',
    path: (tenantId, payload) => `/v1/journal-entries/${payload.journalEntryId}/reverse`,
  },
  // No payload-derived path segment needed for any of these three,
  // unlike case review's :caseId — the policy applies to the whole
  // tenant, not one record.
  COMPLIANCE_KYC_POLICY_PUBLISH: {
    service: 'compliance',
    method: 'POST',
    path: (tenantId) => `/v1/tenants/${tenantId}/compliance/kyc-policy`,
  },
  COMPLIANCE_DEVICE_POLICY_PUBLISH: {
    service: 'compliance',
    method: 'POST',
    path: (tenantId) => `/v1/tenants/${tenantId}/compliance/device-policy`,
  },
  COMPLIANCE_MONITORING_POLICY_PUBLISH: {
    service: 'compliance',
    method: 'POST',
    path: (tenantId) => `/v1/tenants/${tenantId}/compliance/monitoring-policy`,
  },
  // Not a maker-checker action — called directly from src/routes/accounts.js,
  // not via approvalService. Opening a wallet account isn't money-moving or
  // limit-changing (the architecture doc's own maker-checker trigger); it's
  // routine account creation, so it doesn't go through the request/approve
  // flow the other entries above do. Reuses this module purely for its
  // stored-credential + calling-convention handling.
  LEDGER_ACCOUNT_OPEN: {
    service: 'ledger',
    method: 'POST',
    path: () => '/v1/accounts',
  },
  // Also not maker-checker — called directly from src/routes/loans.js,
  // same reasoning as LEDGER_ACCOUNT_OPEN. Loan origination is a
  // deterministic, policy-based eligibility check, not staff discretion.
  LOAN_ELIGIBILITY_CHECK: {
    service: 'compliance',
    method: 'POST',
    path: (tenantId) => `/v1/tenants/${tenantId}/compliance/loan-eligibility-check`,
  },
  // Looks up the customer's current kycTier — the eligibility check
  // needs it, and Compliance doesn't own account state, the Ledger does.
  LEDGER_GET_ACCOUNT_BY_CUSTOMER: {
    service: 'ledger',
    method: 'GET',
    path: (tenantId, payload) => `/v1/customers/${encodeURIComponent(payload.externalCustomerId)}/account`,
  },
  LOAN_LIST_BY_CUSTOMER: {
    service: 'ledger',
    method: 'GET',
    path: (tenantId, payload) => `/v1/customers/${encodeURIComponent(payload.externalCustomerId)}/loans`,
  },
  LOAN_ORIGINATE: {
    service: 'ledger',
    method: 'POST',
    path: () => '/v1/loans',
  },
  // Disbursement IS maker-checker (see approvalService.js's PERMISSIONS)
  // — staff-discretionary release of funds based on a credit judgment,
  // the architecture doc's own trigger for dual approval.
  LOAN_DISBURSEMENT: {
    service: 'ledger',
    method: 'POST',
    path: (tenantId, payload) => `/v1/loans/${payload.loanAccountId}/disburse`,
  },
  COMPLIANCE_LOAN_ELIGIBILITY_POLICY_PUBLISH: {
    service: 'compliance',
    method: 'POST',
    path: (tenantId) => `/v1/tenants/${tenantId}/compliance/loan-eligibility-policy`,
  },
  // Both called directly by delinquencyRunner.js, not maker-checker —
  // mechanical: a scheduled read, and a caller-fed fact the Ledger already
  // computed, same tier as LOAN_ELIGIBILITY_CHECK/LEDGER_ACCOUNT_OPEN.
  LOAN_LIST_ACTIVE: {
    service: 'ledger',
    method: 'GET',
    path: () => '/v1/loans',
  },
  LOAN_DELINQUENCY_FLAG: {
    service: 'compliance',
    method: 'POST',
    path: (tenantId) => `/v1/tenants/${tenantId}/compliance/loan-delinquency-flag`,
  },
};

/**
 * @param {'COMPLIANCE_CASE_REVIEW'|'LEDGER_ADJUSTMENT'|'LEDGER_REVERSAL'|
 *   'COMPLIANCE_KYC_POLICY_PUBLISH'|'COMPLIANCE_DEVICE_POLICY_PUBLISH'|
 *   'COMPLIANCE_MONITORING_POLICY_PUBLISH'} actionType
 * @param {string} tenantId
 * @param {object} payload — the exact request body the target endpoint expects
 * @returns {Promise<object>} the target endpoint's response data
 */
async function execute(actionType, tenantId, payload) {
  const action = ACTIONS[actionType];
  const backend = BACKENDS[action.service];
  const token = await tenantBackendCredentialService.get(tenantId, action.service);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (backend.tenantVia === 'header') headers['X-Tenant-Id'] = tenantId;

  const response = await axios({
    method: action.method,
    url: `${backend.baseUrl}${action.path(tenantId, payload)}`,
    data: payload,
    headers,
    timeout: 15000,
  });
  return backend.tenantVia === 'path' ? response.data.data : response.data;
}

module.exports = { execute, ACTIONS };
