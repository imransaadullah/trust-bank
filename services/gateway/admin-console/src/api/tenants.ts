import { apiRequest } from './client';
import type { Tenant } from '../types/api';

// The login flow's own verification call: pass credentials explicitly
// (nothing is stored yet) and let the real 200/401/403 decide whether
// they're valid, rather than a separate "verify" endpoint that doesn't
// exist on gateway.
export function probeLogin(tenantId: string, apiKey: string) {
  return apiRequest<Tenant>('', { tenantIdOverride: tenantId, apiKeyOverride: apiKey });
}

export function getTenant() {
  return apiRequest<Tenant>('');
}
