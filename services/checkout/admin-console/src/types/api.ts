export interface Merchant {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  webhookUrl: string | null;
  /** Re-readable indefinitely — see merchantService.js's own comment. Not a shown-once secret. */
  webhookSecret: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutSession {
  id: string;
  tenantId: string;
  merchantId: string;
  reference: string;
  provider: string;
  providerRef: string | null;
  authorizationUrl: string;
  amountKobo: number;
  currency: string;
  customerEmail: string;
  description: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  idempotencyKey: string;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  tenantId: string;
  merchantId: string;
  checkoutSessionId: string;
  eventType: string;
  status: string;
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
  deliveredAt: string | null;
}
