-- DropIndex
DROP INDEX "tenant_backend_credentials_tenant_id_service_key";

-- AlterTable
ALTER TABLE "tenant_backend_credentials" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'operate';

-- CreateTable
CREATE TABLE "gateway_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staff_user_id" TEXT NOT NULL,
    "staff_email" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "hashed_token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gateway_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gateway_sessions_token_prefix_key" ON "gateway_sessions"("token_prefix");

-- CreateIndex
CREATE INDEX "gateway_sessions_tenant_id_status_idx" ON "gateway_sessions"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_backend_credentials_tenant_id_service_scope_key" ON "tenant_backend_credentials"("tenant_id", "service", "scope");
