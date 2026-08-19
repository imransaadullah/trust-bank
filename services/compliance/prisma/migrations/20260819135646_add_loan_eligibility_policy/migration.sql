-- CreateTable
CREATE TABLE "loan_eligibility_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'NG',
    "min_kyc_tier" INTEGER NOT NULL,
    "max_loan_amount_kobo" INTEGER NOT NULL,
    "max_tenor_days" INTEGER NOT NULL,
    "interest_rate_annual_bps" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_eligibility_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loan_eligibility_policies_tenant_id_jurisdiction_effective__idx" ON "loan_eligibility_policies"("tenant_id", "jurisdiction", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "loan_eligibility_policies_tenant_id_jurisdiction_version_key" ON "loan_eligibility_policies"("tenant_id", "jurisdiction", "version");
