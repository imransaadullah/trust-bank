-- CreateTable
CREATE TABLE "api_credentials" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "hashed_token" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "api_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_credentials_token_prefix_key" ON "api_credentials"("token_prefix");

-- CreateIndex
CREATE INDEX "api_credentials_tenant_id_idx" ON "api_credentials"("tenant_id");

-- CreateIndex
CREATE INDEX "api_credentials_status_idx" ON "api_credentials"("status");
