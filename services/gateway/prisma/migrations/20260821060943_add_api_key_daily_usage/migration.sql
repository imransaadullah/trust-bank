-- CreateTable
CREATE TABLE "api_key_daily_usage" (
    "id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "api_key_daily_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_key_daily_usage_tenant_id_idx" ON "api_key_daily_usage"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_daily_usage_api_key_id_date_key" ON "api_key_daily_usage"("api_key_id", "date");

-- AddForeignKey
ALTER TABLE "api_key_daily_usage" ADD CONSTRAINT "api_key_daily_usage_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
