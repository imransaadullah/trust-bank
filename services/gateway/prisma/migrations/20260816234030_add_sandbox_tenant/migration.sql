-- CreateTable
CREATE TABLE "sandbox_tenants" (
    "id" TEXT NOT NULL,
    "real_tenant_id" TEXT NOT NULL,
    "sandbox_tenant_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sandbox_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sandbox_tenants_real_tenant_id_key" ON "sandbox_tenants"("real_tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sandbox_tenants_sandbox_tenant_id_key" ON "sandbox_tenants"("sandbox_tenant_id");
