-- CreateTable
CREATE TABLE "cards" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "external_customer_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "last4" TEXT NOT NULL,
    "expiry_month" INTEGER NOT NULL,
    "expiry_year" INTEGER NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "daily_spend_limit_kobo" INTEGER NOT NULL,
    "single_txn_limit_kobo" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_settlements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_settlements_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "tenant_ledger_credentials" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "encrypted_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_ledger_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cards_tenant_id_external_customer_id_idx" ON "cards"("tenant_id", "external_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "card_settlements_idempotency_key_key" ON "card_settlements"("idempotency_key");

-- CreateIndex
CREATE INDEX "card_settlements_card_id_created_at_idx" ON "card_settlements"("card_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_credentials_token_prefix_key" ON "api_credentials"("token_prefix");

-- CreateIndex
CREATE INDEX "api_credentials_tenant_id_idx" ON "api_credentials"("tenant_id");

-- CreateIndex
CREATE INDEX "api_credentials_status_idx" ON "api_credentials"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_ledger_credentials_tenant_id_key" ON "tenant_ledger_credentials"("tenant_id");
