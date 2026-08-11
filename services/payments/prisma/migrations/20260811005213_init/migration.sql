-- CreateTable
CREATE TABLE "tenant_provider_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tenant_slug" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "encrypted_credentials" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provisioned_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "external_customer_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "bank_code" TEXT,
    "bank_name" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provisioned_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_attempts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "external_customer_id" TEXT,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "journal_entry_id" TEXT,
    "failure_reason" TEXT,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "settlement_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_provider_configs_tenant_id_key" ON "tenant_provider_configs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_provider_configs_tenant_slug_key" ON "tenant_provider_configs"("tenant_slug");

-- CreateIndex
CREATE INDEX "tenant_provider_configs_provider_idx" ON "tenant_provider_configs"("provider");

-- CreateIndex
CREATE INDEX "provisioned_accounts_tenant_id_external_customer_id_idx" ON "provisioned_accounts"("tenant_id", "external_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "provisioned_accounts_tenant_id_account_number_key" ON "provisioned_accounts"("tenant_id", "account_number");

-- CreateIndex
CREATE UNIQUE INDEX "provisioned_accounts_tenant_id_external_customer_id_key" ON "provisioned_accounts"("tenant_id", "external_customer_id");

-- CreateIndex
CREATE INDEX "settlement_attempts_tenant_id_status_idx" ON "settlement_attempts"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_attempts_tenant_id_provider_provider_ref_key" ON "settlement_attempts"("tenant_id", "provider", "provider_ref");

-- AddForeignKey
ALTER TABLE "settlement_attempts" ADD CONSTRAINT "settlement_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant_provider_configs"("tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
