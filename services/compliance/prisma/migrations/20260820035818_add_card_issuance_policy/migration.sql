-- CreateTable
CREATE TABLE "card_issuance_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'NG',
    "min_kyc_tier" INTEGER NOT NULL,
    "max_cards_per_customer" INTEGER NOT NULL,
    "daily_spend_limit_kobo" INTEGER NOT NULL,
    "single_txn_limit_kobo" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_issuance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "card_issuance_policies_tenant_id_jurisdiction_effective_fro_idx" ON "card_issuance_policies"("tenant_id", "jurisdiction", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "card_issuance_policies_tenant_id_jurisdiction_version_key" ON "card_issuance_policies"("tenant_id", "jurisdiction", "version");
