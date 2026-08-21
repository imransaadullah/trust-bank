import { apiRequest } from './client';
import type { ApiKeySummary, IssuedApiKey, ApiKeyTier } from '../types/api';

export function listApiKeys() {
  return apiRequest<ApiKeySummary[]>('/api-keys');
}

export function issueApiKey(input: { label: string; tier: ApiKeyTier; rateLimitPerMinute?: number }) {
  return apiRequest<IssuedApiKey>('/api-keys', { method: 'POST', body: input });
}

export function rotateApiKey(apiKeyId: string) {
  return apiRequest<IssuedApiKey>(`/api-keys/${encodeURIComponent(apiKeyId)}/rotate`, { method: 'POST' });
}

export function revokeApiKey(apiKeyId: string) {
  return apiRequest<{ status: string }>(`/api-keys/${encodeURIComponent(apiKeyId)}/revoke`, { method: 'POST' });
}
