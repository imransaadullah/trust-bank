import { apiRequest } from './client';
import type { Branch } from '../types/api';

export function listBranches() {
  return apiRequest<Branch[]>('/v1/branches');
}

export function createBranch(input: { code: string; name: string }) {
  return apiRequest<Branch>('/v1/branches', { method: 'POST', body: input });
}
