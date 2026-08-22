import { apiRequest } from './client';

/**
 * Always resolves successfully regardless of whether a merchant with
 * this email exists — see merchantAuthService.js's own comment on why
 * (no enumeration signal). tenantId is passed explicitly since no
 * session/credential exists yet at this point in the flow.
 */
export function sendOtp(tenantId: string, email: string) {
  return apiRequest<{ sent: boolean }>('/merchant-login/send-otp', {
    method: 'POST',
    tenantIdOverride: tenantId,
    skipAuth: true,
    body: { email },
  });
}

export interface VerifyOtpResult {
  token: string;
  tenantId: string;
  merchantId: string;
  merchantName: string;
  expiresAt: string;
}

export function verifyOtp(tenantId: string, email: string, code: string) {
  return apiRequest<VerifyOtpResult>('/merchant-login/verify-otp', {
    method: 'POST',
    tenantIdOverride: tenantId,
    skipAuth: true,
    body: { email, code },
  });
}

/** A real revoke server-side (see merchantSessionService.revoke), not a client-side no-op. */
export function logout() {
  return apiRequest<{ loggedOut: boolean }>('/merchant-login/logout', { method: 'POST' });
}
