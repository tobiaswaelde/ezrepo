ALTER TABLE "application_settings"
ADD COLUMN "issueRetentionDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN "pullRequestRetentionDays" INTEGER NOT NULL DEFAULT 90;

ALTER TABLE "repositories"
ADD COLUMN "issueRetentionDays" INTEGER,
ADD COLUMN "pullRequestRetentionDays" INTEGER;
