import { apiRequest } from './client';
import type { Merchant } from '../types/api';

export function getMerchant(merchantId: string) {
  return apiRequest<Merchant>(`/merchants/${merchantId}`);
}

export function updateWebhookUrl(merchantId: string, webhookUrl: string) {
  return apiRequest<Merchant>(`/merchants/${merchantId}`, {
    method: 'PATCH',
    body: { webhookUrl },
  });
}

/** Mints a brand-new secret — re-readable indefinitely afterward via getMerchant, not shown-once. */
export function rotateWebhookSecret(merchantId: string) {
  return apiRequest<{ id: string; webhookSecret: string }>(`/merchants/${merchantId}/webhook-secret/rotate`, {
    method: 'POST',
  });
}
