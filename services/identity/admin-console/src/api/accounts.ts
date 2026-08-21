import { apiRequest } from './client';
import type { LedgerAccount } from '../types/api';

export interface OpenAccountInput {
  externalCustomerId: string;
  productType?: string;
  currency?: string;
  kycTier?: number;
  branchId?: string;
}

export function openAccount(input: OpenAccountInput) {
  return apiRequest<LedgerAccount>('/v1/accounts', { method: 'POST', body: input });
}
