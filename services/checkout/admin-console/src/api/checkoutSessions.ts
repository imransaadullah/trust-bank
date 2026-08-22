import { apiRequest } from './client';
import type { CheckoutSession } from '../types/api';

/**
 * No merchantId param — resolveMerchantScope() on the backend already
 * locks a merchant-session caller to their own sessions (req.scopedMerchantId),
 * so passing one here would be redundant at best, ignored at worst.
 */
export function listCheckoutSessions(params: { status?: string; limit?: number } = {}) {
  return apiRequest<CheckoutSession[]>('/checkout-sessions', {
    query: { status: params.status, limit: params.limit?.toString() },
  });
}
