import { z } from 'zod';

/** ISO-8601 timestamp returned by the ezRepo HTTP API. */
export type ApiTimestamp = string;

/** Application-wide date and time presentation supported by the API. */
export const defaultDateTimeFormats = ['LOCALE_SHORT', 'LOCALE_MEDIUM', 'ISO'] as const;

/** Application-wide date and time presentation supported by the API. */
export type DefaultDateTimeFormat = (typeof defaultDateTimeFormats)[number];

/** Global application settings shared by every authenticated client. */
export interface ApplicationSettings {
  dateTimeFormat: DefaultDateTimeFormat;
  workflowRunRetentionDays: number;
}

/** Complete mutable global settings payload accepted from a system administrator. */
export type UpdateApplicationSettings = ApplicationSettings;

/** Current lifecycle state of one MCP bearer token. */
export type McpAccessTokenStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

/** Safe MCP token metadata returned after its one-time creation response. */
export interface McpAccessToken {
  createdAt: ApiTimestamp;
  expiresAt: ApiTimestamp | null;
  id: string;
  lastUsedAt: ApiTimestamp | null;
  name: string;
  revokedAt: ApiTimestamp | null;
  status: McpAccessTokenStatus;
  tokenPrefix: string;
  userId: string;
}

/** One-time MCP token response containing the newly generated bearer secret. */
export interface CreatedMcpAccessToken extends McpAccessToken {
  token: string;
}

/** Input for creating a user-owned MCP bearer token. */
export interface CreateMcpAccessToken {
  expiresAt?: ApiTimestamp | null;
  name: string;
}

/** Validate global settings before sending an administrative update. */
export const applicationSettingsSchema = z.object({
  dateTimeFormat: z.enum(defaultDateTimeFormats),
  workflowRunRetentionDays: z.number().int().min(1).max(3650),
});

/** Source forge type for a configured provider account. */
export const providerTypes = ['GITHUB', 'GITLAB', 'FORGEJO', 'GITEA'] as const;

/** Source forge type for a configured provider account. */
export type ProviderType = (typeof providerTypes)[number];

/** Validate the fields required for an OAuth provider authorization. */
export const providerOAuthFormSchema = z.object({
  baseUrl: z.string().url().optional().or(z.literal('')),
  displayName: z.string().trim().min(1).max(255),
  providerType: z.enum(providerTypes),
});

/** Validate the fields required for a personal-access-token provider account. */
export const providerPatFormSchema = providerOAuthFormSchema
  .extend({
    accessToken: z.string().min(1).max(4096),
    baseUrl: z.string().url().optional().or(z.literal('')),
  })
  .superRefine((provider, context) => {
    if (provider.providerType === 'GITEA' && !provider.baseUrl) {
      context.addIssue({ code: 'custom', message: 'A Gitea base URL is required.', path: ['baseUrl'] });
    }
  });

/** Safe configured provider account. Credentials are never returned by the API. */
export interface ProviderAccount {
  baseUrl: string | null;
  displayName: string;
  enabled: boolean;
  id: string;
  lastSyncAt: ApiTimestamp | null;
  providerType: ProviderType;
}

/** Repository discovered through a configured provider account. */
export interface ProviderRepository {
  name: string;
  owner: string;
  providerRepositoryId: string;
  tracked: boolean;
  url: string;
}

/** Page metadata returned by Query Kit resource endpoints. */
export interface PaginatedResource<T> {
  items: T[];
  meta: {
    hasNextPage: boolean;
    hasPrevPage: boolean;
    itemCount: number;
    page: number;
    pageCount: number;
    perPage: number;
  };
}

/** Input used to start a provider OAuth authorization. */
export interface StartProviderOAuth {
  baseUrl?: string;
  displayName: string;
  providerType: ProviderType;
}

/** Write-only input for a provider account that uses a personal access token. */
export interface CreateProviderAccount {
  accessToken: string;
  baseUrl?: string;
  displayName: string;
  enabled?: boolean;
  providerType: ProviderType;
  webhookSecret?: string;
}

/** Browser destination returned when an OAuth authorization is started. */
export interface ProviderOAuthAuthorization {
  authorizationUrl: string;
}

/** Safe provider authentication capabilities for the current ezRepo installation. */
export interface ProviderAuthenticationOptions {
  oauthProviderTypes: ProviderType[];
}

/** Write-only changes for an existing provider account. */
export interface UpdateProviderAccount {
  accessToken?: string;
  baseUrl?: string | null;
  clearWebhookSecret?: boolean;
  displayName?: string;
  enabled?: boolean;
  webhookSecret?: string;
}

/** Tracked repository and its retention settings. */
export interface Repository {
  enabled: boolean;
  id: string;
  lastSyncAt: ApiTimestamp | null;
  members: RepositoryMemberSummary[];
  name: string;
  owner: string;
  providerAccountId: string;
  url: string;
  workflowRunCount?: number;
  workflowRunRetentionDays: number | null;
}

/** Safe user identity rendered in one repository's member avatar group. */
export interface RepositoryMemberSummary {
  avatarUpdatedAt: ApiTimestamp | null;
  firstName: string | null;
  lastName: string | null;
  userId: string;
  username: string;
}

/** Workflow name filter persisted for one tracked repository. */
export interface WorkflowFilter {
  id: string;
  mode: 'ALLOW' | 'DENY';
  pattern: string;
  repositoryId: string;
}

/** Repository-specific access role assignable to a system user. */
export type RepositoryRole = 'VIEWER' | 'MANAGER';

/** A system user with explicit access to one tracked repository. */
export interface RepositoryMembership {
  id: string;
  repositoryId: string;
  role: RepositoryRole;
  user: Pick<User, 'avatarUpdatedAt' | 'firstName' | 'id' | 'lastName' | 'role' | 'username'>;
  userId: string;
}

/** Safe system user representation. */
export interface User {
  avatarUpdatedAt: ApiTimestamp | null;
  firstName: string | null;
  id: string;
  lastName: string | null;
  username: string;
  role: 'SYSTEM_ADMIN' | 'VIEWER' | 'MANAGER';
  createdAt: ApiTimestamp;
  updatedAt: ApiTimestamp;
}

/** Normalized lifecycle status of a provider workflow run. */
export type WorkflowRunStatus = 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED' | 'UNKNOWN';

/** Safe provider identity included with dashboard data. */
export interface DashboardProvider {
  displayName: string;
  id: string;
  providerType: ProviderType;
}

/** Safe repository identity included with dashboard data. */
export interface DashboardRepository {
  id: string;
  name: string;
  owner: string;
  url: string;
}

/** Workflow run with dashboard-specific repository and provider context. */
export interface DashboardWorkflowRun {
  awaitingApproval: boolean;
  completedAt: ApiTimestamp | null;
  displayTitle: string;
  durationMs: number | null;
  id: string;
  provider: DashboardProvider;
  providerCreatedAt: ApiTimestamp;
  providerRunId: string;
  reviewUrl: string | null;
  repository: DashboardRepository;
  startedAt: ApiTimestamp | null;
  status: WorkflowRunStatus;
  url: string;
  workflowName: string;
}

/** Completed visible workflow-run counts grouped by normalized status. */
export interface DashboardStatusDistribution {
  cancelled: number;
  failed: number;
  skipped: number;
  success: number;
  unknown: number;
}

/** Permission-aware workflow health summary for one requested period. */
export interface DashboardSummary {
  awaitingApprovalCount: number;
  completedCount: number;
  medianDurationMs: number | null;
  queuedCount: number;
  runningCount: number;
  statuses: DashboardStatusDistribution;
  successRate: number;
  totalRunDurationMs: number;
}

/** Permission-aware workflow health aggregates for one visible repository. */
export interface RepositoryHealth {
  completedCount: number;
  failedCount: number;
  medianDurationMs: number | null;
  repository: DashboardRepository;
  successRate: number;
}

/** One bucket size supported by the dashboard workflow trend endpoint. */
export type TrendBucketSize = 'hour' | 'day' | 'week';

/** Inclusive period used by permission-aware dashboard aggregate queries. */
export interface DashboardPeriodQuery {
  from: ApiTimestamp;
  to: ApiTimestamp;
}

/** Parameters for a dashboard workflow trend query. */
export interface WorkflowRunTrendQuery extends DashboardPeriodQuery {
  bucket?: TrendBucketSize;
}

/** Aggregated successful and failed workflow runs for one UTC interval. */
export interface WorkflowRunTrendBucket {
  bucketStart: ApiTimestamp;
  errorCount: number;
  successCount: number;
}

/** One permission-filtered workflow run returned by the resource query endpoint. */
export interface WorkflowRun {
  completedAt: ApiTimestamp | null;
  displayTitle: string;
  durationMs: number | null;
  id: string;
  providerCreatedAt: ApiTimestamp;
  providerRunId: string;
  providerType: ProviderType;
  repositoryId: string;
  repositoryName: string;
  repositoryOwner: string;
  startedAt: ApiTimestamp | null;
  status: WorkflowRunStatus;
  url: string;
  workflowName: string;
}

/** Safe provider identity attached to issues and pull requests. */
export interface WorkItemActor {
  avatarUrl: string | null;
  displayName: string | null;
  url: string | null;
  username: string;
}

/** Repository-specific provider label attached to a work item. */
export interface WorkItemLabel {
  color: string | null;
  description: string | null;
  name: string;
}

interface WorkItemBase {
  assignees: WorkItemActor[];
  author: WorkItemActor | null;
  body?: string | null;
  closedAt: ApiTimestamp | null;
  id: string;
  labels: WorkItemLabel[];
  number: string;
  providerCreatedAt: ApiTimestamp;
  providerType: ProviderType;
  providerUpdatedAt: ApiTimestamp;
  repositoryId: string;
  repositoryName: string;
  repositoryOwner: string;
  title: string;
  url: string;
}

/** Permission-filtered provider issue. */
export interface Issue extends WorkItemBase {
  milestone: string | null;
  state: 'OPEN' | 'CLOSED';
}

/** Permission-filtered provider pull or merge request. */
export interface PullRequest extends WorkItemBase {
  draft: boolean;
  mergedAt: ApiTimestamp | null;
  sourceBranch: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  targetBranch: string;
  workflowApprovalRequired: boolean;
  workflowStatus: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
}

/** Issue overview counters. */
export interface IssueSummary {
  assigned: number;
  open: number;
  recentlyUpdated: number;
  stale: number;
}

/** Pull-request overview counters. */
export interface PullRequestSummary {
  drafts: number;
  failedWorkflows: number;
  open: number;
  workflowApprovalRequired: number;
}

/** Permission-aware values offered by work-item filters. */
export interface WorkItemFilterOptions {
  assignees: string[];
  authors: string[];
  labels: string[];
  milestones: string[];
}

/** Safe repository-scoped notification channel. Secrets are never returned by the API. */
export interface NotificationChannel {
  createdAt: ApiTimestamp;
  enabled: boolean;
  id: string;
  name: string;
  repositoryId: string;
  requiresReconfiguration: boolean;
  updatedAt: ApiTimestamp;
  urlScheme: string | null;
}

/** Input for creating a repository notification channel. */
export interface CreateNotificationChannel {
  enabled?: boolean;
  name: string;
  repositoryId: string;
  url: string;
}

/** Input for updating a repository notification channel. */
export interface UpdateNotificationChannel {
  enabled?: boolean;
  name?: string;
  url?: string;
}

/** Terminal workflow outcome that can match a notification rule. */
export type NotificationRuleOutcome = 'SUCCESS' | 'FAILED';

/** Repository-scoped workflow notification rule. */
export interface NotificationRule {
  channelIds: string[];
  createdAt: ApiTimestamp;
  enabled: boolean;
  id: string;
  outcome: NotificationRuleOutcome;
  repositoryId: string;
  updatedAt: ApiTimestamp;
  workflowPattern: string;
}

/** Input for creating a repository workflow notification rule. */
export interface CreateNotificationRule {
  channelIds: string[];
  enabled?: boolean;
  outcome: NotificationRuleOutcome;
  repositoryId: string;
  workflowPattern: string;
}

/** Input for updating a repository workflow notification rule. */
export interface UpdateNotificationRule {
  channelIds?: string[];
  enabled?: boolean;
  outcome?: NotificationRuleOutcome;
  workflowPattern?: string;
}

/** Current state of an idempotent notification delivery. */
export type NotificationDeliveryStatus = 'PENDING' | 'DELIVERED' | 'FAILED';

/** Safe metadata for one attempted notification transport delivery. */
export interface NotificationDeliveryAttempt {
  attempt: number;
  createdAt: ApiTimestamp;
  deliveredAt: ApiTimestamp | null;
  error: string | null;
  id: string;
  notificationChannelId: string;
}

/** Authorized notification delivery history including safe attempt metadata. */
export interface NotificationDelivery {
  attempts: NotificationDeliveryAttempt[];
  createdAt: ApiTimestamp;
  finalError: string | null;
  id: string;
  nextAttemptAt: ApiTimestamp | null;
  notificationRuleId: string;
  repositoryId: string;
  status: NotificationDeliveryStatus;
  updatedAt: ApiTimestamp;
  workflowRunId: string;
}

/** Last persisted synchronization status for one configured provider account. */
export interface ProviderAccountHealth {
  displayName: string;
  enabled: boolean;
  id: string;
  lastSyncAt: ApiTimestamp | null;
  providerType: ProviderType;
  syncStatus: 'disabled' | 'failed' | 'healthy' | 'unknown';
}

/** Process, database, and persisted provider health response. */
export interface HealthResponse {
  api: 'ok';
  database: 'error' | 'ok';
  providers: ProviderAccountHealth[];
  status: 'degraded' | 'ok';
}
