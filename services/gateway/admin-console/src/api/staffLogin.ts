import { apiRequest } from './client';

interface StaffLoginResponse {
  token: string;
  tenantId: string;
  staffEmail: string;
  expiresAt: string;
}

// Exchanges a pasted Identity staff-session token for a Gateway-native
// GatewaySession token — the credential actually used afterward, not the
// raw staff token (see SessionContext's loginWithStaffSession).
export function staffLogin(tenantId: string, staffSessionToken: string) {
  return apiRequest<StaffLoginResponse>('/staff-login', {
    method: 'POST',
    body: { staffSessionToken },
    tenantIdOverride: tenantId,
    // No apiKeyOverride: this route authenticates via the request body,
    // not a bearer header — no credential to attach yet.
  });
}

// Best-effort: revokes a real GatewaySession server-side, a no-op under
// an API-key login. Called before clearing local credentials either way.
export function logout() {
  return apiRequest<{ loggedOut: boolean }>('/logout', { method: 'POST' });
}
