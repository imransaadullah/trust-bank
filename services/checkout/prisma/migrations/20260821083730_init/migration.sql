-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "webhook_url" TEXT,
    "encrypted_webhook_secret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "authorization_url" TEXT NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "customer_email" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "metadata" JSONB,
    "idempotency_key" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_checkout_provider_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tenant_slug" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "encrypted_credentials" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_checkout_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_ledger_credentials" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "encrypted_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_ledger_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_credentials" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "hashed_token" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "api_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_webhook_deliveries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "checkout_session_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 8,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "merchant_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchants_tenant_id_idx" ON "merchants"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_sessions_reference_key" ON "checkout_sessions"("reference");

-- CreateIndex
CREATE INDEX "checkout_sessions_tenant_id_merchant_id_idx" ON "checkout_sessions"("tenant_id", "merchant_id");

-- CreateIndex
CREATE INDEX "checkout_sessions_status_expires_at_idx" ON "checkout_sessions"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_sessions_tenant_id_idempotency_key_key" ON "checkout_sessions"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_checkout_provider_configs_tenant_id_key" ON "tenant_checkout_provider_configs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_checkout_provider_configs_tenant_slug_key" ON "tenant_checkout_provider_configs"("tenant_slug");

-- CreateIndex
CREATE INDEX "tenant_checkout_provider_configs_provider_idx" ON "tenant_checkout_provider_configs"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_ledger_credentials_tenant_id_key" ON "tenant_ledger_credentials"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_credentials_token_prefix_key" ON "api_credentials"("token_prefix");

-- CreateIndex
CREATE INDEX "api_credentials_tenant_id_idx" ON "api_credentials"("tenant_id");

-- CreateIndex
CREATE INDEX "api_credentials_status_idx" ON "api_credentials"("status");

-- CreateIndex
CREATE INDEX "merchant_webhook_deliveries_status_next_attempt_at_idx" ON "merchant_webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "merchant_webhook_deliveries_tenant_id_idx" ON "merchant_webhook_deliveries"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_webhook_deliveries_checkout_session_id_event_type_key" ON "merchant_webhook_deliveries"("checkout_session_id", "event_type");
