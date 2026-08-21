// A thin fetch wrapper, not axios — ~15 endpoints doesn't justify the
// dependency. Relative /v1/... paths only: the Vite dev server proxies
// them to identity's own dev server (vite.config.ts), and in production
// the page is served by identity itself, so the same origin already
// serves both the console's static assets and its API.
const TOKEN_KEY = 'trustbank_staff_session_token';

// A handful of error responses (e.g. 422 LOAN_NOT_ELIGIBLE) carry a
// `data` payload alongside the error — the raw envelope shape isn't
// exposed by ApiErrorBody alone, so this widens it locally.
interface ApiErrorEnvelope {
  success: false;
  error: string;
  code?: string;
  data?: unknown;
}

export class ApiError extends Error {
  code?: string;
  status: number;
  data?: unknown;
  constructor(message: string, status: number, code?: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

// Set by SessionContext once react-query's QueryClient exists, so a 401
// can wipe cached data before redirecting — avoids a re-login briefly
// flashing the previous user's stale cache.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | undefined>;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query } = options;

  let url = path;
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
  if (token) headers.Authorization = `Bearer ${token}`;

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

    // A 401 with no token present means this was a login-time failure
    // (bad credentials, bad MFA code) — not an expired real session.
    // Only redirect-on-401 when a session actually existed.
    if (response.status === 401 && token) {
      clearToken();
      onUnauthorized?.();
    }

    throw new ApiError(message, response.status, code, errorBody?.data);
  }

  return (json as { data: T }).data;
}
