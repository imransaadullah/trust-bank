import { apiRequest } from './client';
import type { ComplianceCase } from '../types/api';

export function listComplianceCases(filters?: { status?: string; caseType?: string }) {
  return apiRequest<ComplianceCase[]>('/v1/compliance-cases', { query: filters });
}
