-- CreateTable
CREATE TABLE "tenant_backend_credentials" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "encrypted_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_backend_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_by_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "executed_at" TIMESTAMP(3),
    "execution_result" JSONB,
    "execution_error" TEXT,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_backend_credentials_tenant_id_service_key" ON "tenant_backend_credentials"("tenant_id", "service");

-- CreateIndex
CREATE INDEX "approval_requests_tenant_id_status_idx" ON "approval_requests"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
