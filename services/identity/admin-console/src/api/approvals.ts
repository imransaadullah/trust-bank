import { apiRequest } from './client';
import type { Approval, ActionType, ApprovalStatus } from '../types/api';

export function listApprovals(status?: ApprovalStatus) {
  return apiRequest<Approval[]>('/v1/approvals', { query: { status } });
}

export function getApproval(id: string) {
  return apiRequest<Approval>(`/v1/approvals/${id}`);
}

export function requestApproval(input: { actionType: ActionType; payload: Record<string, unknown> }) {
  return apiRequest<Approval>('/v1/approvals', { method: 'POST', body: input });
}

export function approveApproval(id: string) {
  return apiRequest<Approval>(`/v1/approvals/${id}/approve`, { method: 'POST' });
}

export function rejectApproval(id: string, reason: string) {
  return apiRequest<Approval>(`/v1/approvals/${id}/reject`, { method: 'POST', body: { reason } });
}

export function retryExecution(id: string) {
  return apiRequest<Approval>(`/v1/approvals/${id}/retry-execution`, { method: 'POST' });
}
