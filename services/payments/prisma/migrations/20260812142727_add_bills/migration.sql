-- CreateTable
CREATE TABLE "tenant_bills_provider_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "encrypted_credentials" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_bills_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payment_attempts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "external_customer_id" TEXT NOT NULL,
    "biller_code" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "journal_entry_id" TEXT,
    "failure_reason" TEXT,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "bill_payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_bills_provider_configs_tenant_id_key" ON "tenant_bills_provider_configs"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_bills_provider_configs_provider_idx" ON "tenant_bills_provider_configs"("provider");

-- CreateIndex
CREATE INDEX "bill_payment_attempts_tenant_id_status_idx" ON "bill_payment_attempts"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payment_attempts_tenant_id_provider_provider_ref_key" ON "bill_payment_attempts"("tenant_id", "provider", "provider_ref");
