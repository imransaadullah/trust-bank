// A thin fetch wrapper, not axios — this handful of endpoints doesn't
// justify the dependency. Relative /v1/... paths only: the Vite dev
// server proxies them to gateway's own dev server (vite.config.ts), and
// in production the page is served by gateway itself, so the same
// origin already serves both the console's static assets and its API.
//
// Unlike the staff console's single bearer session token, this app's
// credential is a {tenantId, apiKey} pair — every real gateway route is
// path-scoped as /v1/tenants/:tenantId/..., so apiRequest prefixes every
// call with the stored tenant id automatically; callers pass only the
// resource-relative path (e.g. '/api-keys', or '' for the tenant itself).
const TENANT_ID_KEY = 'trustbank_tenant_id';
const API_KEY_KEY = 'trustbank_tenant_api_key';

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

export function getApiKey(): string | null {
  return sessionStorage.getItem(API_KEY_KEY);
}

export function setCredentials(tenantId: string, apiKey: string): void {
  sessionStorage.setItem(TENANT_ID_KEY, tenantId);
  sessionStorage.setItem(API_KEY_KEY, apiKey);
}

export function clearCredentials(): void {
  sessionStorage.removeItem(TENANT_ID_KEY);
  sessionStorage.removeItem(API_KEY_KEY);
}

// Set by SessionContext once react-query's QueryClient exists, so a 401
// can wipe cached data before redirecting — avoids a re-login briefly
// flashing the previous tenant's stale cache.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | undefined>;
  /** Only the login flow's first probe call has no stored tenant id yet — pass it explicitly. */
  tenantIdOverride?: string;
  apiKeyOverride?: string;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, tenantIdOverride, apiKeyOverride } = options;
  const tenantId = tenantIdOverride ?? getTenantId();
  const apiKey = apiKeyOverride ?? getApiKey();
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
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

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

    // A 401 with no stored key present means this was a login-time
    // failure (bad/revoked key) — not an expired real session. Only
    // redirect-on-401 when a session actually existed already.
    if (response.status === 401 && getApiKey() && !apiKeyOverride) {
      clearCredentials();
      onUnauthorized?.();
    }

    throw new ApiError(message, response.status, code);
  }

  return (json as { data: T }).data;
}
