import type { ProviderType, WorkflowKind, WorkflowRunStatus } from '../../generated/prisma/client.js';

/** Injection token for the read-only HTTP client used by provider adapters. */
export const PROVIDER_FETCH = Symbol('PROVIDER_FETCH');

/** Credentials used only for read-only requests to a configured provider account. */
export interface ProviderAccountContext {
  accessToken: string;
  baseUrl: string | null;
  providerAccountId: string;
}

/** Repository returned by a provider's repository-discovery API. */
export interface ProviderRepository {
  name: string;
  owner: string;
  providerRepositoryId: string;
  url: string;
}

/** Repository identity retained by ezRepo for provider run requests. */
export interface ProviderRepositoryReference {
  name: string;
  owner: string;
  providerRepositoryId: string;
}

/** Shared provider identity attached to an issue or pull request. */
export interface ProviderActor {
  avatarUrl: string | null;
  displayName: string | null;
  providerActorId: string;
  url: string | null;
  username: string;
}

/** Provider label normalized without losing its repository-specific presentation. */
export interface ProviderWorkItemLabel {
  color: string | null;
  description: string | null;
  name: string;
  providerLabelId: string | null;
}

/** Window used for an initial or incremental work-item synchronization. */
export interface ProviderWorkItemQuery {
  includeAllOpen: boolean;
  updatedAfter: Date;
}

/** Provider issue normalized before persistence in ezRepo. */
export interface ProviderIssue {
  assignees: ProviderActor[];
  author: ProviderActor | null;
  body: string | null;
  closedAt: Date | null;
  labels: ProviderWorkItemLabel[];
  milestone: string | null;
  number: string;
  providerCreatedAt: Date;
  providerIssueId: string;
  providerUpdatedAt: Date;
  state: 'OPEN' | 'CLOSED';
  title: string;
  url: string;
}

/** Provider pull or merge request normalized before persistence in ezRepo. */
export interface ProviderPullRequest {
  assignees: ProviderActor[];
  author: ProviderActor | null;
  body: string | null;
  closedAt: Date | null;
  draft: boolean;
  labels: ProviderWorkItemLabel[];
  mergedAt: Date | null;
  number: string;
  providerCreatedAt: Date;
  providerPullRequestId: string;
  providerUpdatedAt: Date;
  sourceBranch: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  targetBranch: string;
  title: string;
  url: string;
}

/** Read-only lifecycle metadata used to retire obsolete change-request workflow failures. */
export interface ProviderChangeRequestState {
  mergedAt: Date | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  targetBranch: string | null;
}

/** Provider workflow run normalized before persistence in ezRepo. */
export interface ProviderWorkflowRun {
  awaitingApproval: boolean;
  changeRequestNumber: string | null;
  completedAt: Date | null;
  displayTitle: string;
  durationMs: number | null;
  event: string | null;
  headBranch: string | null;
  headSha: string | null;
  providerCreatedAt: Date;
  providerRunId: string;
  providerWorkflowId: string;
  rawStatus: string | null;
  reviewUrl: string | null;
  scopeKey: string;
  startedAt: Date | null;
  status: WorkflowRunStatus;
  url: string;
  workflowKind: WorkflowKind;
  workflowName: string;
  workflowPath: string | null;
}

/** Build the stable execution context used to decide whether a workflow is currently failing. */
export function buildWorkflowRunScopeKey(changeRequestNumber: string | null, headBranch: string | null): string {
  if (changeRequestNumber) return `change-request:${changeRequestNumber}`;
  if (headBranch) return `branch:${headBranch}`;
  return 'repository';
}

/** Result of validating a provider account without mutating provider state. */
export interface ProviderAccountValidation {
  displayName: string;
  valid: boolean;
}

/** Verified provider webhook details safe to hand to synchronization code. */
export interface VerifiedWebhook {
  event: string;
  providerRepositoryId: string | null;
  syncScopes: ProviderSyncScope[];
}

/** Independently coalesced domains supported by repository synchronization. */
export type ProviderSyncScope = 'WORKFLOWS' | 'ISSUES' | 'PULL_REQUESTS';

/** Map provider webhook event names to the smallest safe synchronization scope. */
export function providerWebhookSyncScopes(event: string): ProviderSyncScope[] {
  const normalized = event.toLocaleLowerCase('en-US');
  if (normalized.includes('issue') && !normalized.includes('pull')) return ['ISSUES'];
  if (normalized.includes('pull') || normalized.includes('merge request')) return ['PULL_REQUESTS'];
  if (normalized.includes('workflow') || normalized.includes('pipeline') || normalized.includes('job'))
    return ['WORKFLOWS'];
  return ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS'];
}

/** Read-only webhook request data received by ezRepo. */
export interface ProviderWebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  payload: Uint8Array;
  signingSecret: string;
}

/**
 * Contract every provider adapter must implement.
 *
 * This deliberately permits only validation, discovery, synchronization reads,
 * and webhook verification. It contains no operation that can alter provider
 * accounts, repositories, workflows, or provider webhook registrations.
 */
export interface ProviderAdapter {
  readonly providerType: ProviderType;

  getChangeRequestState(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    changeRequestNumber: string,
  ): Promise<ProviderChangeRequestState | null>;
  getRepository(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
  ): Promise<ProviderRepository | null>;
  getWorkflowRun(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    providerRunId: string,
  ): Promise<ProviderWorkflowRun | null>;
  listIssues(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    query: ProviderWorkItemQuery,
  ): Promise<ProviderIssue[]>;
  listPullRequests(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    query: ProviderWorkItemQuery,
  ): Promise<ProviderPullRequest[]>;
  listRepositories(context: ProviderAccountContext): Promise<ProviderRepository[]>;
  listWorkflowRuns(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    updatedAfter?: Date,
  ): Promise<ProviderWorkflowRun[]>;
  validateAccount(context: ProviderAccountContext): Promise<ProviderAccountValidation>;
  verifyWebhook(request: ProviderWebhookRequest): Promise<VerifiedWebhook | null>;
}
