import { apiRequest } from './client';
import type { Merchant } from '../types/api';

// Hits Gateway's own /admin/merchants proxy (services/gateway/src/routes/
// merchantsAdmin.js), not Checkout directly — same as every other page
// in this console. Distinct from a tenant's own banking-tier /merchants
// integration routes (checkout.js), which this admin-tier key can't use.
export function listMerchants() {
  return apiRequest<Merchant[]>('/admin/merchants');
}

export function getMerchant(merchantId: string) {
  return apiRequest<Merchant>(`/admin/merchants/${merchantId}`);
}

export function updateWebhookUrl(merchantId: string, webhookUrl: string) {
  return apiRequest<Merchant>(`/admin/merchants/${merchantId}`, {
    method: 'PATCH',
    body: { webhookUrl },
  });
}

/** Mints a brand-new secret on the merchant's behalf — re-readable indefinitely afterward, not shown-once. */
export function rotateWebhookSecret(merchantId: string) {
  return apiRequest<{ id: string; webhookSecret: string }>(`/admin/merchants/${merchantId}/webhook-secret/rotate`, {
    method: 'POST',
  });
}
