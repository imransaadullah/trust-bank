import { apiRequest } from './client';
import type { Me } from '../types/api';

export interface LoginResponse {
  mfaChallengeToken: string;
  mfaEnrolled: boolean;
}

export function login(input: { tenantId: string; email: string; password: string }) {
  return apiRequest<LoginResponse>('/v1/login', { method: 'POST', body: input });
}

export function mfaEnroll(mfaChallengeToken: string) {
  return apiRequest<{ otpauthUri: string }>('/v1/mfa/enroll', { method: 'POST', body: { mfaChallengeToken } });
}

export interface SessionResponse {
  sessionToken: string;
  expiresAt: string;
}

export function mfaEnrollConfirm(mfaChallengeToken: string, code: string) {
  return apiRequest<SessionResponse>('/v1/mfa/enroll/confirm', { method: 'POST', body: { mfaChallengeToken, code } });
}

export function loginMfa(mfaChallengeToken: string, code: string) {
  return apiRequest<SessionResponse>('/v1/login/mfa', { method: 'POST', body: { mfaChallengeToken, code } });
}

export function logout() {
  return apiRequest<{ loggedOut: true }>('/v1/logout', { method: 'POST' });
}

export function changePassword(input: { currentPassword: string; newPassword: string }) {
  return apiRequest<{ changed: true }>('/v1/change-password', { method: 'POST', body: input });
}

export function getMe() {
  return apiRequest<Me>('/v1/me');
}
