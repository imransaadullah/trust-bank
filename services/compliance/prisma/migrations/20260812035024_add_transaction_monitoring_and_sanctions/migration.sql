-- CreateTable
CREATE TABLE "transaction_monitoring_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'NG',
    "velocity_window_hours" INTEGER NOT NULL,
    "velocity_max_transaction_count" INTEGER NOT NULL,
    "velocity_max_distinct_counterparties" INTEGER NOT NULL,
    "structuring_threshold_kobo" INTEGER NOT NULL,
    "structuring_window_count" INTEGER NOT NULL,
    "large_single_txn_threshold_kobo" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_monitoring_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sanctions_watchlist_entries" (
    "id" TEXT NOT NULL,
    "list_source" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "date_of_birth" TIMESTAMP(3),
    "import_batch_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanctions_watchlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_cases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "case_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "matched_rules" JSONB NOT NULL,
    "context" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transaction_monitoring_policies_tenant_id_jurisdiction_effe_idx" ON "transaction_monitoring_policies"("tenant_id", "jurisdiction", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_monitoring_policies_tenant_id_jurisdiction_vers_key" ON "transaction_monitoring_policies"("tenant_id", "jurisdiction", "version");

-- CreateIndex
CREATE INDEX "sanctions_watchlist_entries_full_name_idx" ON "sanctions_watchlist_entries"("full_name");

-- CreateIndex
CREATE INDEX "compliance_cases_tenant_id_status_created_at_idx" ON "compliance_cases"("tenant_id", "status", "created_at");
