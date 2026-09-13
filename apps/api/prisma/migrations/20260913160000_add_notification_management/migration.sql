CREATE TYPE "NotificationChannelType" AS ENUM ('EMAIL', 'GOTIFY', 'NTFY', 'DISCORD', 'CUSTOM_APPRISE', 'BROWSER_PUSH');
CREATE TYPE "NotificationDeliveryKind" AS ENUM ('WORKFLOW_RUN', 'TEST');

ALTER TABLE "notification_channels"
  ADD COLUMN "type" "NotificationChannelType" NOT NULL DEFAULT 'CUSTOM_APPRISE',
  ADD COLUMN "browserRecipientUserId" UUID;

UPDATE "notification_channels"
SET "type" = CASE
  WHEN "urlScheme" IN ('mailto', 'mailtos') THEN 'EMAIL'::"NotificationChannelType"
  WHEN "urlScheme" IN ('gotify', 'gotifys') THEN 'GOTIFY'::"NotificationChannelType"
  WHEN "urlScheme" IN ('ntfy', 'ntfys') THEN 'NTFY'::"NotificationChannelType"
  WHEN "urlScheme" = 'discord' THEN 'DISCORD'::"NotificationChannelType"
  ELSE 'CUSTOM_APPRISE'::"NotificationChannelType"
END;

ALTER TABLE "notification_deliveries"
  ADD COLUMN "kind" "NotificationDeliveryKind" NOT NULL DEFAULT 'WORKFLOW_RUN',
  ADD COLUMN "testChannelId" UUID,
  ADD COLUMN "requestedByUserId" UUID,
  ALTER COLUMN "notificationRuleId" DROP NOT NULL,
  ALTER COLUMN "workflowRunId" DROP NOT NULL;

CREATE TABLE "browser_push_subscriptions" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "endpointHash" VARCHAR(64) NOT NULL,
  "encryptedEndpoint" TEXT NOT NULL,
  "encryptedP256dh" TEXT NOT NULL,
  "encryptedAuth" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  CONSTRAINT "browser_push_subscriptions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "notification_delivery_attempts" ADD COLUMN "browserPushSubscriptionId" UUID;
DROP INDEX "notification_delivery_attempts_notificationDeliveryId_notificationChannelId_attempt_key";

CREATE UNIQUE INDEX "browser_push_subscriptions_endpointHash_key" ON "browser_push_subscriptions"("endpointHash");
CREATE INDEX "browser_push_subscriptions_userId_updatedAt_idx" ON "browser_push_subscriptions"("userId", "updatedAt");
CREATE INDEX "notification_channels_browserRecipientUserId_idx" ON "notification_channels"("browserRecipientUserId");
CREATE INDEX "notification_deliveries_testChannelId_createdAt_idx" ON "notification_deliveries"("testChannelId", "createdAt");
CREATE INDEX "notification_deliveries_requestedByUserId_createdAt_idx" ON "notification_deliveries"("requestedByUserId", "createdAt");
CREATE INDEX "notification_delivery_attempts_browserPushSubscriptionId_createdAt_idx" ON "notification_delivery_attempts"("browserPushSubscriptionId", "createdAt");
CREATE INDEX "notification_delivery_attempts_delivery_channel_attempt_idx" ON "notification_delivery_attempts"("notificationDeliveryId", "notificationChannelId", "attempt");
CREATE UNIQUE INDEX "notification_delivery_attempts_channel_attempt_unique"
  ON "notification_delivery_attempts"("notificationDeliveryId", "notificationChannelId", "attempt")
  WHERE "browserPushSubscriptionId" IS NULL;
CREATE UNIQUE INDEX "notification_delivery_attempts_push_attempt_unique"
  ON "notification_delivery_attempts"("notificationDeliveryId", "notificationChannelId", "browserPushSubscriptionId", "attempt")
  WHERE "browserPushSubscriptionId" IS NOT NULL;

ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_browserRecipientUserId_fkey"
  FOREIGN KEY ("browserRecipientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_testChannelId_fkey"
  FOREIGN KEY ("testChannelId") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "browser_push_subscriptions" ADD CONSTRAINT "browser_push_subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_browserPushSubscriptionId_fkey"
  FOREIGN KEY ("browserPushSubscriptionId") REFERENCES "browser_push_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
