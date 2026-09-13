-- Existing provider-wide secrets cannot safely represent per-repository webhook configuration.
-- Deliveries are operational idempotency records, so reset them during the intentional hard cutover.
DELETE FROM "webhook_deliveries";

ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_providerAccountId_fkey";
DROP INDEX "webhook_deliveries_providerAccountId_deliveryId_key";
DROP INDEX "webhook_deliveries_providerAccountId_createdAt_idx";

ALTER TABLE "provider_accounts" DROP COLUMN "encryptedWebhookSecret";
ALTER TABLE "repositories" ADD COLUMN "encryptedWebhookSecret" TEXT;

ALTER TABLE "webhook_deliveries"
  DROP COLUMN "providerAccountId",
  DROP COLUMN "providerRepositoryId",
  ADD COLUMN "repositoryId" UUID NOT NULL;

CREATE UNIQUE INDEX "webhook_deliveries_repositoryId_deliveryId_key"
  ON "webhook_deliveries"("repositoryId", "deliveryId");
CREATE INDEX "webhook_deliveries_repositoryId_createdAt_idx"
  ON "webhook_deliveries"("repositoryId", "createdAt");

ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
