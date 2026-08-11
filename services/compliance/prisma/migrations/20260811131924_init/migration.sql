-- CreateTable
CREATE TABLE "kyc_tier_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'NG',
    "tier" INTEGER NOT NULL,
    "required_verifications" JSONB NOT NULL,
    "daily_limit_kobo" INTEGER,
    "single_txn_limit_kobo" INTEGER,
    "version" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_tier_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_binding_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'NG',
    "max_active_devices" INTEGER NOT NULL DEFAULT 1,
    "new_device_cooldown_hours" INTEGER NOT NULL,
    "new_device_limit_kobo" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_binding_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kyc_tier_policies_tenant_id_jurisdiction_tier_effective_fro_idx" ON "kyc_tier_policies"("tenant_id", "jurisdiction", "tier", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_tier_policies_tenant_id_jurisdiction_tier_version_key" ON "kyc_tier_policies"("tenant_id", "jurisdiction", "tier", "version");

-- CreateIndex
CREATE INDEX "device_binding_policies_tenant_id_jurisdiction_effective_fr_idx" ON "device_binding_policies"("tenant_id", "jurisdiction", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "device_binding_policies_tenant_id_jurisdiction_version_key" ON "device_binding_policies"("tenant_id", "jurisdiction", "version");
