export type ApiKeyTier = 'sandbox' | 'production';
export type ApiKeyStatus = 'active' | 'revoked';
export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDING';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  licenseType: string;
  deploymentMode: string;
  status: TenantStatus;
  baseCurrency: string;
}

export interface ApiKeySummary {
  id: string;
  label: string;
  tier: ApiKeyTier | 'admin';
  tokenPrefix: string;
  status: ApiKeyStatus;
  rateLimitPerMinute: number;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface IssuedApiKey {
  id: string;
  label: string;
  tier: ApiKeyTier;
  tokenPrefix: string;
  rateLimitPerMinute: number;
  /** Shown once — the caller must copy it now, it cannot be retrieved again. */
  token: string;
}

export interface UsageDailyPoint {
  date: string;
  requestCount: number;
}

export interface UsageKey {
  apiKeyId: string;
  label: string;
  tier: string;
  totalRequests: number;
  daily: UsageDailyPoint[];
}

export interface UsageResponse {
  from: string;
  to: string;
  keys: UsageKey[];
}

export interface SandboxMapping {
  tenantId: string;
  sandboxTenantId: string;
}

export interface Merchant {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  webhookUrl: string | null;
  /** Re-readable indefinitely — see services/checkout's own merchantService.js comment. Not a shown-once secret. */
  webhookSecret: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export type PolicyType = 'kyc' | 'device' | 'loan-eligibility' | 'card-issuance' | 'monitoring';

/** A versioned policy row — shape varies by type, always carries version/effectiveFrom. */
export type PolicyRecord = Record<string, unknown> & {
  version: number;
  effectiveFrom: string;
};
