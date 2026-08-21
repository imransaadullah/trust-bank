import { apiRequest } from './client';
import type { LoanAccount } from '../types/api';

export interface OriginateLoanInput {
  externalCustomerId: string;
  principalKobo: number;
  tenorDays: number;
  branchId?: string;
}

// On 422 LOAN_NOT_ELIGIBLE, the caller catches ApiError and reads
// err.code === 'LOAN_NOT_ELIGIBLE' / err.data as a LoanEligibilityDecision.
export function originateLoan(input: OriginateLoanInput) {
  return apiRequest<LoanAccount>('/v1/loans', { method: 'POST', body: input });
}
