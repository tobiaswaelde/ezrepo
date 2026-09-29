CREATE TYPE "SecurityAlertKind" AS ENUM ('DEPENDENCY', 'CODE', 'SECRET');
CREATE TYPE "SecurityAlertState" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');
CREATE TYPE "SecurityAlertSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN');
CREATE TYPE "SecurityAlertAvailability" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'UNSUPPORTED');

ALTER TYPE "RepositorySyncProgressPhase" ADD VALUE 'SYNCING_ALERTS';
ALTER TYPE "RepositorySyncRequestStatus" ADD VALUE 'WARNING';
ALTER TYPE "NotificationEventType" ADD VALUE 'DEPENDENCY_ALERT_OPENED';
ALTER TYPE "NotificationEventType" ADD VALUE 'DEPENDENCY_ALERT_RESOLVED';
ALTER TYPE "NotificationEventType" ADD VALUE 'CODE_ALERT_OPENED';
ALTER TYPE "NotificationEventType" ADD VALUE 'CODE_ALERT_RESOLVED';
ALTER TYPE "NotificationEventType" ADD VALUE 'SECRET_ALERT_OPENED';
ALTER TYPE "NotificationEventType" ADD VALUE 'SECRET_ALERT_RESOLVED';

ALTER TABLE "repository_sync_requests" ADD COLUMN "syncAlerts" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "security_alerts" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "kind" "SecurityAlertKind" NOT NULL,
  "state" "SecurityAlertState" NOT NULL,
  "severity" "SecurityAlertSeverity" NOT NULL,
  "providerAlertId" VARCHAR(255) NOT NULL,
  "title" VARCHAR(1024) NOT NULL,
  "description" TEXT,
  "identifiers" TEXT[],
  "scanner" VARCHAR(255),
  "providerCreatedAt" TIMESTAMP(3) NOT NULL,
  "providerUpdatedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "resolution" VARCHAR(255),
  "providerUrl" VARCHAR(2048) NOT NULL,
  "packageName" VARCHAR(512),
  "ecosystem" VARCHAR(255),
  "manifest" VARCHAR(1024),
  "vulnerableRange" VARCHAR(1024),
  "fixedVersion" VARCHAR(255),
  "ruleId" VARCHAR(255),
  "tool" VARCHAR(255),
  "secretType" VARCHAR(255),
  "secretProvider" VARCHAR(255),
  "location" JSONB,
  "repositoryId" UUID NOT NULL,
  CONSTRAINT "security_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_alerts_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "security_alerts_repositoryId_kind_providerAlertId_key" ON "security_alerts"("repositoryId", "kind", "providerAlertId");
CREATE INDEX "security_alerts_repositoryId_kind_state_severity_idx" ON "security_alerts"("repositoryId", "kind", "state", "severity");
CREATE INDEX "security_alerts_providerUpdatedAt_idx" ON "security_alerts"("providerUpdatedAt");

CREATE TABLE "security_alert_sync_states" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "kind" "SecurityAlertKind" NOT NULL,
  "availability" "SecurityAlertAvailability" NOT NULL,
  "reason" VARCHAR(512),
  "lastSuccessfulSyncAt" TIMESTAMP(3),
  "synchronizedThrough" TIMESTAMP(3),
  "baselineEstablished" BOOLEAN NOT NULL DEFAULT false,
  "repositoryId" UUID NOT NULL,
  CONSTRAINT "security_alert_sync_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_alert_sync_states_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "security_alert_sync_states_repositoryId_kind_key" ON "security_alert_sync_states"("repositoryId", "kind");
CREATE INDEX "security_alert_sync_states_availability_kind_idx" ON "security_alert_sync_states"("availability", "kind");

ALTER TABLE "notification_deliveries" ADD COLUMN "securityAlertId" UUID;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_securityAlertId_fkey" FOREIGN KEY ("securityAlertId") REFERENCES "security_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
