-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "identity_provider_uid" TEXT;

-- CreateTable
CREATE TABLE "merchant_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "merchant_email" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "hashed_token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchant_sessions_token_prefix_key" ON "merchant_sessions"("token_prefix");

-- CreateIndex
CREATE INDEX "merchant_sessions_tenant_id_merchant_id_status_idx" ON "merchant_sessions"("tenant_id", "merchant_id", "status");

-- CreateIndex
CREATE INDEX "merchant_webhook_deliveries_tenant_id_merchant_id_idx" ON "merchant_webhook_deliveries"("tenant_id", "merchant_id");

-- CreateIndex
CREATE INDEX "merchants_tenant_id_email_idx" ON "merchants"("tenant_id", "email");
