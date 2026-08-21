import { apiRequest } from './client';
import type { PolicyType, PolicyRecord } from '../types/api';

export const POLICY_TYPES: { value: PolicyType; label: string; path: string; needsTier: boolean }[] = [
  { value: 'kyc', label: 'KYC tier', path: 'kyc-policy', needsTier: true },
  { value: 'device', label: 'Device binding', path: 'device-policy', needsTier: false },
  { value: 'loan-eligibility', label: 'Loan eligibility', path: 'loan-eligibility-policy', needsTier: false },
  { value: 'card-issuance', label: 'Card issuance', path: 'card-issuance-policy', needsTier: false },
  { value: 'monitoring', label: 'Transaction monitoring', path: 'monitoring-policy', needsTier: false },
];

// One field per type, matching each publish route's own required fields
// exactly (services/compliance/src/routes/policies.js, routes/monitoring.js).
export const PAYLOAD_PLACEHOLDERS: Record<PolicyType, string> = {
  kyc: '{\n  "tier": 1,\n  "requiredVerifications": ["bvn", "liveness"],\n  "dailyLimitKobo": 50000000,\n  "singleTxnLimitKobo": 20000000\n}',
  device: '{\n  "maxActiveDevices": 1,\n  "newDeviceCooldownHours": 24,\n  "newDeviceLimitKobo": 5000000\n}',
  'loan-eligibility': '{\n  "minKycTier": 1,\n  "maxLoanAmountKobo": 50000000,\n  "maxTenorDays": 180,\n  "interestRateAnnualBps": 2400\n}',
  'card-issuance': '{\n  "minKycTier": 1,\n  "maxCardsPerCustomer": 2,\n  "dailySpendLimitKobo": 30000000,\n  "singleTxnLimitKobo": 10000000\n}',
  monitoring:
    '{\n  "velocityWindowHours": 24,\n  "velocityMaxTransactionCount": 20,\n  "velocityMaxDistinctCounterparties": 10,\n  "structuringThresholdKobo": 100000000,\n  "structuringWindowCount": 3,\n  "largeSingleTxnThresholdKobo": 500000000\n}',
};

function pathFor(type: PolicyType) {
  return POLICY_TYPES.find((t) => t.value === type)!.path;
}

export function getPolicy(type: PolicyType, params: { tier?: string; jurisdiction?: string } = {}) {
  return apiRequest<PolicyRecord>(`/compliance/${pathFor(type)}`, { query: params });
}

export function publishPolicy(type: PolicyType, payload: Record<string, unknown>) {
  return apiRequest<PolicyRecord>(`/compliance/${pathFor(type)}`, { method: 'POST', body: payload });
}
