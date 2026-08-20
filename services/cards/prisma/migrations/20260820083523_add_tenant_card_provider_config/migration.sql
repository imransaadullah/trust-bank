-- CreateTable
CREATE TABLE "tenant_card_provider_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tenant_slug" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "encrypted_credentials" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_card_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_card_provider_configs_tenant_id_key" ON "tenant_card_provider_configs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_card_provider_configs_tenant_slug_key" ON "tenant_card_provider_configs"("tenant_slug");

-- CreateIndex
CREATE INDEX "tenant_card_provider_configs_provider_idx" ON "tenant_card_provider_configs"("provider");
