-- The repository-scoped notification feature has not retained compatible data.
-- Reset configuration, history, attempts, and personal browser registrations before rebuilding it globally.
DROP TABLE "notification_delivery_attempts";
DROP TABLE "notification_deliveries";
DROP TABLE "notification_rule_channels";
DROP TABLE "notification_rules";
DROP TABLE "notification_channels";
DROP TABLE "browser_push_subscriptions";

DROP TYPE "NotificationRuleOutcome";
DROP TYPE "NotificationDeliveryKind";

CREATE TYPE "NotificationDeliveryKind" AS ENUM ('EVENT', 'TEST');
CREATE TYPE "NotificationEventType" AS ENUM (
  'WORKFLOW_RUN_SUCCEEDED',
  'WORKFLOW_RUN_FAILED',
  'WORKFLOW_RUN_RECOVERED',
  'PULL_REQUEST_OPENED',
  'PULL_REQUEST_CLOSED',
  'PULL_REQUEST_REOPENED',
  'PULL_REQUEST_MERGED',
  'ISSUE_OPENED',
  'ISSUE_CLOSED',
  'ISSUE_REOPENED'
);

CREATE TABLE "notification_channels" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "type" "NotificationChannelType" NOT NULL DEFAULT 'CUSTOM_APPRISE',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "encryptedUrl" TEXT,
  "urlScheme" VARCHAR(64),
  "requiresReconfiguration" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_event_subscriptions" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "eventType" "NotificationEventType" NOT NULL,
  "workflowPatterns" TEXT[] NOT NULL,
  "notificationChannelId" UUID NOT NULL,
  CONSTRAINT "notification_event_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_event_subscription_repositories" (
  "notificationEventSubscriptionId" UUID NOT NULL,
  "repositoryId" UUID NOT NULL,
  CONSTRAINT "notification_event_subscription_repositories_pkey"
    PRIMARY KEY ("notificationEventSubscriptionId", "repositoryId")
);

CREATE TABLE "notification_channel_recipients" (
  "notificationChannelId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  CONSTRAINT "notification_channel_recipients_pkey" PRIMARY KEY ("notificationChannelId", "userId")
);

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

CREATE TABLE "notification_deliveries" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "kind" "NotificationDeliveryKind" NOT NULL DEFAULT 'EVENT',
  "eventType" "NotificationEventType",
  "deduplicationKey" VARCHAR(1024) NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "finalError" TEXT,
  "nextAttemptAt" TIMESTAMP(3),
  "notificationChannelId" UUID NOT NULL,
  "repositoryId" UUID,
  "workflowRunId" UUID,
  "issueId" UUID,
  "pullRequestId" UUID,
  "requestedByUserId" UUID,
  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_delivery_attempts" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempt" INTEGER NOT NULL,
  "deliveredAt" TIMESTAMP(3),
  "error" TEXT,
  "notificationDeliveryId" UUID NOT NULL,
  "notificationChannelId" UUID NOT NULL,
  "browserPushSubscriptionId" UUID,
  CONSTRAINT "notification_delivery_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_channels_name_key" ON "notification_channels"("name");
CREATE INDEX "notification_channels_enabled_name_idx" ON "notification_channels"("enabled", "name");
CREATE UNIQUE INDEX "notification_event_subscriptions_notificationChannelId_even_key"
  ON "notification_event_subscriptions"("notificationChannelId", "eventType");
CREATE INDEX "notification_event_subscriptions_eventType_notificationChan_idx"
  ON "notification_event_subscriptions"("eventType", "notificationChannelId");
CREATE INDEX "notification_event_subscription_repositories_repositoryId_idx"
  ON "notification_event_subscription_repositories"("repositoryId");
CREATE INDEX "notification_channel_recipients_userId_idx" ON "notification_channel_recipients"("userId");
CREATE UNIQUE INDEX "browser_push_subscriptions_endpointHash_key" ON "browser_push_subscriptions"("endpointHash");
CREATE INDEX "browser_push_subscriptions_userId_updatedAt_idx" ON "browser_push_subscriptions"("userId", "updatedAt");
CREATE UNIQUE INDEX "notification_deliveries_notificationChannelId_deduplication_key"
  ON "notification_deliveries"("notificationChannelId", "deduplicationKey");
CREATE INDEX "notification_deliveries_status_createdAt_idx" ON "notification_deliveries"("status", "createdAt");
CREATE INDEX "notification_deliveries_status_nextAttemptAt_idx" ON "notification_deliveries"("status", "nextAttemptAt");
CREATE INDEX "notification_deliveries_repositoryId_createdAt_idx" ON "notification_deliveries"("repositoryId", "createdAt");
CREATE INDEX "notification_deliveries_eventType_createdAt_idx" ON "notification_deliveries"("eventType", "createdAt");
CREATE INDEX "notification_deliveries_requestedByUserId_createdAt_idx"
  ON "notification_deliveries"("requestedByUserId", "createdAt");
CREATE INDEX "notification_delivery_attempts_delivery_channel_attempt_idx"
  ON "notification_delivery_attempts"("notificationDeliveryId", "notificationChannelId", "attempt");
CREATE INDEX "notification_delivery_attempts_notificationChannelId_createdAt_idx"
  ON "notification_delivery_attempts"("notificationChannelId", "createdAt");
CREATE INDEX "notification_delivery_attempts_browserPushSubscriptionId_cr_idx"
  ON "notification_delivery_attempts"("browserPushSubscriptionId", "createdAt");
CREATE UNIQUE INDEX "notification_delivery_attempts_channel_attempt_unique"
  ON "notification_delivery_attempts"("notificationDeliveryId", "notificationChannelId", "attempt")
  WHERE "browserPushSubscriptionId" IS NULL;
CREATE UNIQUE INDEX "notification_delivery_attempts_push_attempt_unique"
  ON "notification_delivery_attempts"(
    "notificationDeliveryId",
    "notificationChannelId",
    "browserPushSubscriptionId",
    "attempt"
  ) WHERE "browserPushSubscriptionId" IS NOT NULL;

ALTER TABLE "notification_event_subscriptions" ADD CONSTRAINT "notification_event_subscriptions_notificationChannelId_fkey"
  FOREIGN KEY ("notificationChannelId") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_event_subscription_repositories"
  ADD CONSTRAINT "notification_event_subscription_repositories_notificationE_fkey"
  FOREIGN KEY ("notificationEventSubscriptionId") REFERENCES "notification_event_subscriptions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_event_subscription_repositories"
  ADD CONSTRAINT "notification_event_subscription_repositories_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_channel_recipients" ADD CONSTRAINT "notification_channel_recipients_notificationChannelId_fkey"
  FOREIGN KEY ("notificationChannelId") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_channel_recipients" ADD CONSTRAINT "notification_channel_recipients_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "browser_push_subscriptions" ADD CONSTRAINT "browser_push_subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationChannelId_fkey"
  FOREIGN KEY ("notificationChannelId") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_workflowRunId_fkey"
  FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_issueId_fkey"
  FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_pullRequestId_fkey"
  FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_notificationDeliveryId_fkey"
  FOREIGN KEY ("notificationDeliveryId") REFERENCES "notification_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_notificationChannelId_fkey"
  FOREIGN KEY ("notificationChannelId") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_browserPushSubscriptionId_fkey"
  FOREIGN KEY ("browserPushSubscriptionId") REFERENCES "browser_push_subscriptions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
