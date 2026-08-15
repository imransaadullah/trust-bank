-- DropIndex
DROP INDEX "users_authcore_uid_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "authcore_uid",
ADD COLUMN     "identity_provider_uid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_identity_provider_uid_key" ON "users"("identity_provider_uid");
