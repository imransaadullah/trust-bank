import { apiRequest } from './client';
import type { Merchant } from '../types/api';

export function getMerchant(merchantId: string) {
  return apiRequest<Merchant>(`/merchants/${merchantId}`);
}

/** Mints a brand-new secret — re-readable indefinitely afterward via getMerchant, not shown-once. */
export function rotateWebhookSecret(merchantId: string) {
  return apiRequest<{ id: string; webhookSecret: string }>(`/merchants/${merchantId}/webhook-secret/rotate`, {
    method: 'POST',
  });
}
