CREATE TYPE "RepositorySyncProgressPhase" AS ENUM (
    'LOADING_REPOSITORY',
    'SYNCING_ISSUES',
    'SYNCING_PULL_REQUESTS',
    'FETCHING_WORKFLOWS',
    'PROCESSING_WORKFLOWS',
    'REFRESHING_CHANGE_REQUESTS'
);

ALTER TABLE "repository_sync_requests"
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "progressPhase" "RepositorySyncProgressPhase",
ADD COLUMN "progressCurrent" INTEGER,
ADD COLUMN "progressTotal" INTEGER;
