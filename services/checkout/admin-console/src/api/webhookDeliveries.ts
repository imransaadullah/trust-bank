import { apiRequest } from './client';
import type { WebhookDelivery } from '../types/api';

/**
 * merchantId is required by the route's own path shape
 * (/merchants/:merchantId/deliveries) — forbidCrossMerchant on the
 * backend 403s if it doesn't match the caller's own session, so this
 * only ever succeeds passing the logged-in merchant's own id.
 */
export function listDeliveries(merchantId: string, params: { status?: string; limit?: number } = {}) {
  return apiRequest<WebhookDelivery[]>(`/merchants/${merchantId}/deliveries`, {
    query: { status: params.status, limit: params.limit?.toString() },
  });
}
