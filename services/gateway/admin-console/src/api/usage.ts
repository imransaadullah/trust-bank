import { apiRequest } from './client';
import type { UsageResponse } from '../types/api';

export function getUsage(range?: { from?: string; to?: string }) {
  return apiRequest<UsageResponse>('/usage', { query: range });
}
