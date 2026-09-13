CREATE TYPE "WorkItemSyncKind" AS ENUM ('ISSUE', 'PULL_REQUEST');
CREATE TYPE "IssueState" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "PullRequestState" AS ENUM ('OPEN', 'CLOSED', 'MERGED');
CREATE TYPE "PullRequestWorkflowStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'UNKNOWN');

ALTER TABLE "repository_sync_requests"
ADD COLUMN "syncWorkflows" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "syncIssues" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "syncPullRequests" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "work_item_sync_cursors" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "kind" "WorkItemSyncKind" NOT NULL,
  "synchronizedThrough" TIMESTAMP(3),
  "repositoryId" UUID NOT NULL,
  CONSTRAINT "work_item_sync_cursors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_actors" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "providerActorId" VARCHAR(255) NOT NULL,
  "username" VARCHAR(255) NOT NULL,
  "displayName" VARCHAR(255),
  "avatarUrl" VARCHAR(2048),
  "url" VARCHAR(2048),
  "providerAccountId" UUID NOT NULL,
  CONSTRAINT "provider_actors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_item_labels" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "providerLabelId" VARCHAR(255),
  "name" VARCHAR(255) NOT NULL,
  "normalizedName" VARCHAR(255) NOT NULL,
  "color" VARCHAR(32),
  "description" TEXT,
  "repositoryId" UUID NOT NULL,
  CONSTRAINT "work_item_labels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "issues" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "providerIssueId" VARCHAR(255) NOT NULL,
  "number" VARCHAR(255) NOT NULL,
  "title" VARCHAR(1024) NOT NULL,
  "body" TEXT,
  "state" "IssueState" NOT NULL,
  "url" VARCHAR(2048) NOT NULL,
  "providerCreatedAt" TIMESTAMP(3) NOT NULL,
  "providerUpdatedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "milestone" VARCHAR(512),
  "repositoryId" UUID NOT NULL,
  "authorId" UUID,
  CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "issue_assignees" (
  "issueId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  CONSTRAINT "issue_assignees_pkey" PRIMARY KEY ("issueId", "actorId")
);

CREATE TABLE "issue_labels" (
  "issueId" UUID NOT NULL,
  "labelId" UUID NOT NULL,
  CONSTRAINT "issue_labels_pkey" PRIMARY KEY ("issueId", "labelId")
);

CREATE TABLE "pull_requests" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "providerPullRequestId" VARCHAR(255) NOT NULL,
  "number" VARCHAR(255) NOT NULL,
  "title" VARCHAR(1024) NOT NULL,
  "body" TEXT,
  "state" "PullRequestState" NOT NULL,
  "draft" BOOLEAN NOT NULL DEFAULT false,
  "sourceBranch" VARCHAR(1024) NOT NULL,
  "targetBranch" VARCHAR(1024) NOT NULL,
  "url" VARCHAR(2048) NOT NULL,
  "providerCreatedAt" TIMESTAMP(3) NOT NULL,
  "providerUpdatedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "mergedAt" TIMESTAMP(3),
  "workflowStatus" "PullRequestWorkflowStatus" NOT NULL DEFAULT 'UNKNOWN',
  "workflowApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
  "repositoryId" UUID NOT NULL,
  "authorId" UUID,
  CONSTRAINT "pull_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pull_request_assignees" (
  "pullRequestId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  CONSTRAINT "pull_request_assignees_pkey" PRIMARY KEY ("pullRequestId", "actorId")
);

CREATE TABLE "pull_request_labels" (
  "pullRequestId" UUID NOT NULL,
  "labelId" UUID NOT NULL,
  CONSTRAINT "pull_request_labels_pkey" PRIMARY KEY ("pullRequestId", "labelId")
);

ALTER TABLE "workflow_runs" ADD COLUMN "pullRequestId" UUID;

CREATE UNIQUE INDEX "work_item_sync_cursors_repositoryId_kind_key" ON "work_item_sync_cursors"("repositoryId", "kind");
CREATE INDEX "provider_actors_providerAccountId_username_idx" ON "provider_actors"("providerAccountId", "username");
CREATE UNIQUE INDEX "provider_actors_providerAccountId_providerActorId_key" ON "provider_actors"("providerAccountId", "providerActorId");
CREATE INDEX "work_item_labels_repositoryId_name_idx" ON "work_item_labels"("repositoryId", "name");
CREATE UNIQUE INDEX "work_item_labels_repositoryId_normalizedName_key" ON "work_item_labels"("repositoryId", "normalizedName");
CREATE INDEX "issues_repositoryId_state_providerUpdatedAt_idx" ON "issues"("repositoryId", "state", "providerUpdatedAt");
CREATE INDEX "issues_authorId_idx" ON "issues"("authorId");
CREATE UNIQUE INDEX "issues_repositoryId_providerIssueId_key" ON "issues"("repositoryId", "providerIssueId");
CREATE UNIQUE INDEX "issues_repositoryId_number_key" ON "issues"("repositoryId", "number");
CREATE INDEX "issue_assignees_actorId_idx" ON "issue_assignees"("actorId");
CREATE INDEX "issue_labels_labelId_idx" ON "issue_labels"("labelId");
CREATE INDEX "pull_requests_repositoryId_state_providerUpdatedAt_idx" ON "pull_requests"("repositoryId", "state", "providerUpdatedAt");
CREATE INDEX "pull_requests_repositoryId_workflowStatus_workflowApprovalR_idx" ON "pull_requests"("repositoryId", "workflowStatus", "workflowApprovalRequired");
CREATE INDEX "pull_requests_authorId_idx" ON "pull_requests"("authorId");
CREATE UNIQUE INDEX "pull_requests_repositoryId_providerPullRequestId_key" ON "pull_requests"("repositoryId", "providerPullRequestId");
CREATE UNIQUE INDEX "pull_requests_repositoryId_number_key" ON "pull_requests"("repositoryId", "number");
CREATE INDEX "pull_request_assignees_actorId_idx" ON "pull_request_assignees"("actorId");
CREATE INDEX "pull_request_labels_labelId_idx" ON "pull_request_labels"("labelId");
CREATE INDEX "workflow_runs_pullRequestId_providerCreatedAt_idx" ON "workflow_runs"("pullRequestId", "providerCreatedAt");

ALTER TABLE "work_item_sync_cursors" ADD CONSTRAINT "work_item_sync_cursors_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_actors" ADD CONSTRAINT "provider_actors_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "provider_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_item_labels" ADD CONSTRAINT "work_item_labels_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issues" ADD CONSTRAINT "issues_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issues" ADD CONSTRAINT "issues_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "provider_actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "issue_assignees" ADD CONSTRAINT "issue_assignees_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_assignees" ADD CONSTRAINT "issue_assignees_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "provider_actors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "work_item_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "provider_actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pull_request_assignees" ADD CONSTRAINT "pull_request_assignees_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pull_request_assignees" ADD CONSTRAINT "pull_request_assignees_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "provider_actors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pull_request_labels" ADD CONSTRAINT "pull_request_labels_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pull_request_labels" ADD CONSTRAINT "pull_request_labels_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "work_item_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER INDEX "workflow_runs_repositoryId_changeRequestNumber_changeRequestChe" RENAME TO "workflow_runs_repositoryId_changeRequestNumber_changeReques_idx";
