import type {
  ProviderType,
  SecurityAlertKind,
  SecurityAlertSeverity,
  SecurityAlertState,
  WorkflowKind,
  WorkflowRunStatus,
} from '../../generated/prisma/client.js';

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

/** Safe normalized provider alert persisted without raw provider payloads or secret values. */
export interface ProviderSecurityAlert {
  description: string | null;
  ecosystem: string | null;
  fixedVersion: string | null;
  identifiers: string[];
  kind: SecurityAlertKind;
  location: Record<string, number | string> | null;
  manifest: string | null;
  packageName: string | null;
  providerAlertId: string;
  providerCreatedAt: Date;
  providerUpdatedAt: Date;
  providerUrl: string;
  resolution: string | null;
  resolvedAt: Date | null;
  ruleId: string | null;
  scanner: string | null;
  secretProvider: string | null;
  secretType: string | null;
  severity: SecurityAlertSeverity;
  state: SecurityAlertState;
  title: string;
  tool: string | null;
  vulnerableRange: string | null;
}

/** Per-kind provider result that keeps unsupported and unavailable APIs independent. */
export interface ProviderSecurityAlertResult {
  alerts: ProviderSecurityAlert[];
  availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNSUPPORTED';
  kind: SecurityAlertKind;
  reason: string | null;
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

/**
 * Build the stable execution context used to decide whether a workflow is currently failing.
 *
 * @param changeRequestNumber - Provider-local issue or merge-request number.
 * @param headBranch - Source branch name, or null when the provider does not supply one.
 * @returns A stable change-request, branch, or repository scope key.
 */
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
export type ProviderSyncScope = 'WORKFLOWS' | 'ISSUES' | 'PULL_REQUESTS' | 'ALERTS';

/**
 * Map provider webhook event names to the smallest safe synchronization scope.
 *
 * @param event - Provider webhook event name used to select synchronization domains.
 * @returns The repository domains affected by the provider event.
 */
export function providerWebhookSyncScopes(event: string): ProviderSyncScope[] {
  const normalized = event.toLocaleLowerCase('en-US');
  if (normalized.includes('issue') && !normalized.includes('pull')) return ['ISSUES'];
  if (normalized.includes('pull') || normalized.includes('merge request')) return ['PULL_REQUESTS'];
  if (normalized.includes('workflow') || normalized.includes('pipeline') || normalized.includes('job'))
    return ['WORKFLOWS'];
  if (normalized.includes('security') || normalized.includes('vulnerability') || normalized.includes('dependabot'))
    return ['ALERTS'];
  return ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS', 'ALERTS'];
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

  /**
   * Read and normalize the lifecycle state of one provider change request.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @param repository - Repository identity and metadata required by the operation.
   * @param changeRequestNumber - Provider-local issue or merge-request number.
   * @returns Normalized change-request state, or null when the provider reports it missing.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  getChangeRequestState(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    changeRequestNumber: string,
  ): Promise<ProviderChangeRequestState | null>;
  /**
   * Read and normalize one provider repository, treating a missing repository as absent.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @param repository - Repository identity and metadata required by the operation.
   * @returns Normalized repository metadata, or null when the provider reports it missing.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  getRepository(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
  ): Promise<ProviderRepository | null>;
  /**
   * Read and normalize one workflow run, treating a missing run as absent.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @param repository - Repository identity and metadata required by the operation.
   * @param providerRunId - Provider-assigned workflow run identifier.
   * @returns The normalized run, or null when the provider reports it missing.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  getWorkflowRun(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    providerRunId: string,
  ): Promise<ProviderWorkflowRun | null>;
  /**
   * Read recently updated issues and optionally all open issues, merging duplicate provider IDs.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @param repository - Repository identity and metadata required by the operation.
   * @param query - Incremental update boundary and whether to include all currently open items.
   * @returns Deduplicated normalized issues for the requested window.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  listIssues(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    query: ProviderWorkItemQuery,
  ): Promise<ProviderIssue[]>;
  /**
   * Read recently updated pull requests and optionally all open requests, merging duplicate IDs.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @param repository - Repository identity and metadata required by the operation.
   * @param query - Incremental update boundary and whether to include all currently open items.
   * @returns Deduplicated normalized pull requests for the requested window.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  listPullRequests(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    query: ProviderWorkItemQuery,
  ): Promise<ProviderPullRequest[]>;
  /**
   * Read normalized security alerts without exposing provider payloads or secret material.
   *
   * Omission means that the provider does not expose a supported read API.
   *
   * @param context - Provider account credentials and instance configuration.
   * @param repository - Repository whose alerts are requested.
   * @returns Per-kind normalized alerts and availability.
   */
  listSecurityAlerts?(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
  ): Promise<ProviderSecurityAlertResult[]>;
  /**
   * Read repositories accessible through the provider account and normalize their metadata.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @returns Normalized repositories accessible through the account.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  listRepositories(context: ProviderAccountContext): Promise<ProviderRepository[]>;
  /**
   * Read and normalize workflow runs within the provider synchronization window.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @param repository - Repository identity and metadata required by the operation.
   * @param updatedAfter - Optional lower boundary for incremental provider synchronization.
   * @returns Normalized runs collected for the requested synchronization window.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  listWorkflowRuns(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    updatedAfter?: Date,
  ): Promise<ProviderWorkflowRun[]>;
  /**
   * Read the provider identity to verify credentials without modifying provider resources.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @returns The validated provider identity and display name.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  validateAccount(context: ProviderAccountContext): Promise<ProviderAccountValidation>;
  /**
   * Verify provider webhook authentication before returning its repository and synchronization scopes.
   *
   * @param request - Incoming request with the authentication or webhook context required by this endpoint.
   * @returns Verified event metadata and requested scopes, or null when authentication is invalid.
   */
  verifyWebhook(request: ProviderWebhookRequest): Promise<VerifiedWebhook | null>;
}
