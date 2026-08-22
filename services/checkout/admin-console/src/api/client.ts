// A thin fetch wrapper, not axios — same reasoning as
// services/gateway/admin-console's own client.ts. Relative /v1/... paths
// only: the Vite dev server proxies them to checkout's own dev server
// (vite.config.ts), and in production the page is served by checkout
// itself, so the same origin already serves both the console's static
// assets and its API.
//
// Unlike the tenant dashboard's {tenantId, apiKey} pair, this app's
// credential is a single mch_live_ MerchantSession token — the
// merchant-login send-otp/verify-otp calls themselves carry no
// Authorization header at all (skipAuth), since they ARE the
// authentication step; every route mounts under
// /v1/tenants/:tenantId/..., so apiRequest prefixes every call with the
// stored tenant id automatically.
const TENANT_ID_KEY = 'trustbank_merchant_tenant_id';
const TOKEN_KEY = 'trustbank_merchant_session_token';

interface ApiErrorEnvelope {
  success: false;
  error: string;
  code?: string;
}

export class ApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function getTenantId(): string | null {
  return sessionStorage.getItem(TENANT_ID_KEY);
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setCredentials(tenantId: string, token: string): void {
  sessionStorage.setItem(TENANT_ID_KEY, tenantId);
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearCredentials(): void {
  sessionStorage.removeItem(TENANT_ID_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

// Set by SessionContext once react-query's QueryClient exists, so a 401
// can wipe cached data before redirecting — avoids a re-login briefly
// flashing the previous merchant's stale cache.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  query?: Record<string, string | undefined>;
  /** Only the login flow's own tenant id, before any session exists yet. */
  tenantIdOverride?: string;
  /** The login flow's send-otp/verify-otp calls carry no session token at all. */
  skipAuth?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, tenantIdOverride, skipAuth } = options;
  const tenantId = tenantIdOverride ?? getTenantId();
  if (!tenantId) throw new ApiError('No tenant ID set', 0);

  let url = `/v1/tenants/${encodeURIComponent(tenantId)}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, value);
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (!skipAuth && token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const errorBody = json as ApiErrorEnvelope | null;
    const message = errorBody?.error || `Request failed with status ${response.status}`;
    const code = errorBody?.code;

    // A 401 with no stored token present means this was a login-time
    // failure — not an expired real session. Only redirect-on-401 when a
    // session actually existed already.
    if (response.status === 401 && !skipAuth && getToken()) {
      clearCredentials();
      onUnauthorized?.();
    }

    throw new ApiError(message, response.status, code);
  }

  return (json as { data: T }).data;
}
