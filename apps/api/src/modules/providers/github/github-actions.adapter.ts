import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  ProviderAccountContext,
  ProviderAccountValidation,
  ProviderActor,
  ProviderAdapter,
  ProviderChangeRequestState,
  ProviderIssue,
  ProviderPullRequest,
  ProviderRepository,
  ProviderRepositoryReference,
  ProviderWebhookRequest,
  ProviderWorkItemLabel,
  ProviderWorkItemQuery,
  ProviderWorkflowRun,
  VerifiedWebhook,
} from '../provider-adapter.js';
import { PROVIDER_FETCH, buildWorkflowRunScopeKey, providerWebhookSyncScopes } from '../provider-adapter.js';
import { providerRequestError } from '../provider-request.error.js';
import { isWorkflowRunAwaitingApproval, normalizeWorkflowRunStatus } from '../workflow-status.js';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface GitHubRepositoryResponse {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  owner: { login: string };
}
interface GitHubWorkflowRunResponse {
  display_title?: string;
  event?: string;
  head_branch?: string | null;
  head_sha?: string | null;
  id: number;
  name: string;
  path?: string;
  html_url: string;
  created_at: string;
  run_started_at: string | null;
  updated_at: string;
  status: string;
  conclusion: string | null;
  pull_requests?: { number: number }[];
  workflow_id?: number;
}
interface GitHubPullRequestResponse {
  base?: { ref?: string };
  merged_at?: string | null;
  number: number;
  state: string;
}
interface GitHubActorResponse {
  avatar_url?: string;
  html_url?: string;
  id: number;
  login: string;
  name?: string | null;
}
interface GitHubLabelResponse {
  color?: string;
  description?: string | null;
  id?: number;
  name: string;
}
interface GitHubIssueResponse {
  assignees?: GitHubActorResponse[];
  body?: string | null;
  closed_at?: string | null;
  created_at: string;
  html_url: string;
  id: number;
  labels?: (GitHubLabelResponse | string)[];
  milestone?: { title: string } | null;
  number: number;
  pull_request?: unknown;
  state: string;
  title: string;
  updated_at: string;
  user?: GitHubActorResponse | null;
}
interface GitHubPullResponse extends GitHubIssueResponse {
  base: { ref: string };
  draft?: boolean;
  head: { ref: string };
  merged_at?: string | null;
}

const dependabotWorkflowPath = 'dynamic/dependabot/dependabot-updates';

/** GitHub Actions adapter that only reads repositories, runs, and webhook metadata. */
@Injectable()
export class GitHubActionsAdapter implements ProviderAdapter {
  readonly providerType = 'GITHUB' as const;

  /**
   * Initialize GitHubActionsAdapter with its required dependencies.
   *
   * @param fetchFn - Fetch implementation used for read-only provider requests.
   */
  constructor(@Inject(PROVIDER_FETCH) private readonly fetchFn: FetchLike = fetch) {}

  /**
   * Read the provider identity to verify credentials without modifying provider resources.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @returns The validated provider identity and display name.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  async validateAccount(context: ProviderAccountContext): Promise<ProviderAccountValidation> {
    const account = await this.request<{ login: string }>(context, '/user');
    return { displayName: account.login, valid: true };
  }

  /**
   * Read repositories accessible through the provider account and normalize their metadata.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @returns Normalized repositories accessible through the account.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  async listRepositories(context: ProviderAccountContext): Promise<ProviderRepository[]> {
    const repositories = await this.request<GitHubRepositoryResponse[]>(context, '/user/repos?per_page=100');
    return repositories.map((repository) => this.toRepository(repository));
  }

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
  async getChangeRequestState(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    changeRequestNumber: string,
  ): Promise<ProviderChangeRequestState | null> {
    const response = await this.fetchFn(
      this.url(context, `/repos/${repository.owner}/${repository.name}/pulls/${changeRequestNumber}`),
      { headers: this.headers(context) },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw providerRequestError('GitHub', response);
    const pullRequest = (await response.json()) as GitHubPullRequestResponse;
    const mergedAt = pullRequest.merged_at ? new Date(pullRequest.merged_at) : null;
    return {
      mergedAt,
      state: mergedAt ? 'MERGED' : pullRequest.state === 'closed' ? 'CLOSED' : 'OPEN',
      targetBranch: pullRequest.base?.ref ?? null,
    };
  }

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
  async getRepository(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
  ): Promise<ProviderRepository | null> {
    const response = await this.fetchFn(this.url(context, `/repos/${repository.owner}/${repository.name}`), {
      headers: this.headers(context),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw providerRequestError('GitHub', response);
    return this.toRepository((await response.json()) as GitHubRepositoryResponse);
  }

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
  async listWorkflowRuns(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    updatedAfter?: Date,
  ): Promise<ProviderWorkflowRun[]> {
    const runs: GitHubWorkflowRunResponse[] = [];
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({ page: String(page), per_page: '100' });
      if (updatedAfter) query.set('created', `>=${updatedAfter.toISOString()}`);
      const response = await this.request<{ workflow_runs: GitHubWorkflowRunResponse[] }>(
        context,
        `/repos/${repository.owner}/${repository.name}/actions/runs?${query}`,
      );
      runs.push(...response.workflow_runs);
      if (response.workflow_runs.length < 100) break;
    }
    return Promise.all(runs.map((run) => this.resolveWorkflowRun(context, repository, run)));
  }

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
  async getWorkflowRun(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    providerRunId: string,
  ): Promise<ProviderWorkflowRun | null> {
    const response = await this.fetchFn(
      this.url(context, `/repos/${repository.owner}/${repository.name}/actions/runs/${providerRunId}`),
      { headers: this.headers(context) },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw providerRequestError('GitHub', response);
    return this.resolveWorkflowRun(context, repository, (await response.json()) as GitHubWorkflowRunResponse);
  }

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
  async listIssues(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    query: ProviderWorkItemQuery,
  ): Promise<ProviderIssue[]> {
    const path = `/repos/${repository.owner}/${repository.name}/issues`;
    const recent = await this.listPages<GitHubIssueResponse>(context, path, {
      direction: 'desc',
      since: query.updatedAfter.toISOString(),
      sort: 'updated',
      state: 'all',
    });
    const open = query.includeAllOpen
      ? await this.listPages<GitHubIssueResponse>(context, path, { direction: 'desc', sort: 'updated', state: 'open' })
      : [];
    return this.uniqueById([...recent, ...open])
      .filter((issue) => !issue.pull_request)
      .map((issue) => this.toIssue(issue));
  }

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
  async listPullRequests(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    query: ProviderWorkItemQuery,
  ): Promise<ProviderPullRequest[]> {
    const path = `/repos/${repository.owner}/${repository.name}/pulls`;
    const recent = await this.listPages<GitHubPullResponse>(
      context,
      path,
      { direction: 'desc', sort: 'updated', state: 'all' },
      (pullRequest) => new Date(pullRequest.updated_at) >= query.updatedAfter,
    );
    const open = query.includeAllOpen
      ? await this.listPages<GitHubPullResponse>(context, path, { direction: 'desc', sort: 'updated', state: 'open' })
      : [];
    return this.uniqueById([...recent, ...open]).map((pullRequest) => this.toPullRequest(pullRequest));
  }

  /**
   * Verify provider webhook authentication before returning its repository and synchronization scopes.
   *
   * @param request - Incoming request with the authentication or webhook context required by this endpoint.
   * @returns Verified event metadata and requested scopes, or null when authentication is invalid.
   * @throws SyntaxError - When an authenticated webhook body is not valid JSON.
   */
  async verifyWebhook(request: ProviderWebhookRequest): Promise<VerifiedWebhook | null> {
    const signature = request.headers['x-hub-signature-256'];
    const event = request.headers['x-github-event'];
    if (typeof signature !== 'string' || typeof event !== 'string') return null;
    const expected = `sha256=${createHmac('sha256', request.signingSecret).update(request.payload).digest('hex')}`;
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
      return null;
    const payload = JSON.parse(Buffer.from(request.payload).toString('utf8')) as { repository?: { id?: number } };
    return {
      event,
      providerRepositoryId: payload.repository?.id ? String(payload.repository.id) : null,
      syncScopes: providerWebhookSyncScopes(event),
    };
  }

  /**
   * Perform an authenticated read-only provider request and decode its JSON response.
   *
   * @typeParam T - Expected decoded provider response shape.
   * @param context - Provider account credentials and instance configuration for this request.
   * @param path - Provider API path relative to the configured instance.
   * @returns The decoded provider JSON response.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  private async request<T>(context: ProviderAccountContext, path: string): Promise<T> {
    const response = await this.fetchFn(this.url(context, path), { headers: this.headers(context) });
    if (!response.ok) throw providerRequestError('GitHub', response);
    return (await response.json()) as T;
  }

  /**
   * Read provider pages until exhausted or the synchronization boundary is reached.
   *
   * @typeParam T - Provider record type preserved in the result.
   * @param context - Provider account credentials and instance configuration for this request.
   * @param path - Provider API path relative to the configured instance.
   * @param parameters - Query-string values sent with every page request.
   * @param keepReading - Predicate retaining items and identifying the incremental pagination boundary.
   * @returns Accepted records collected across provider pages.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  private async listPages<T extends { id: number }>(
    context: ProviderAccountContext,
    path: string,
    parameters: Record<string, string>,
    keepReading: (item: T) => boolean = () => true,
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({ ...parameters, page: String(page), per_page: '100' });
      const result = await this.request<T[]>(context, `${path}?${query}`);
      items.push(...result.filter(keepReading));
      if (result.length < 100 || (result.length > 0 && !keepReading(result[result.length - 1]!))) break;
    }
    return items;
  }

  /**
   * Deduplicate provider records by ID, keeping the last occurrence of each record.
   *
   * @typeParam T - Provider record type preserved in the result.
   * @param items - Records used to build the result.
   * @returns One record per ID in first-insertion order, containing the last value for that ID.
   */
  private uniqueById<T extends { id: number }>(items: T[]): T[] {
    return [...new Map(items.map((item) => [item.id, item])).values()];
  }

  /**
   * Normalize an optional provider actor without inventing a missing identity.
   *
   * @param actor - Optional provider user identity associated with a work item.
   * @returns The normalized actor, or null when no actor is supplied.
   */
  private toActor(actor: GitHubActorResponse | null | undefined): ProviderActor | null {
    if (!actor) return null;
    return {
      avatarUrl: actor.avatar_url ?? null,
      displayName: actor.name ?? null,
      providerActorId: String(actor.id),
      url: actor.html_url ?? null,
      username: actor.login,
    };
  }

  /**
   * Normalize provider label identity and presentation metadata.
   *
   * @param label - Human-readable field name used in validation errors.
   * @returns Normalized label metadata.
   */
  private toLabel(label: GitHubLabelResponse | string): ProviderWorkItemLabel {
    if (typeof label === 'string') return { color: null, description: null, name: label, providerLabelId: null };
    return {
      color: label.color ?? null,
      description: label.description ?? null,
      name: label.name,
      providerLabelId: label.id === undefined ? null : String(label.id),
    };
  }

  /**
   * Normalize a provider issue and its author, assignees, labels, and lifecycle metadata.
   *
   * @param issue - Issue data being normalized, persisted, or used as an event source.
   * @returns The normalized issue and its related metadata.
   */
  private toIssue(issue: GitHubIssueResponse): ProviderIssue {
    return {
      assignees: (issue.assignees ?? []).flatMap((actor) => this.toActor(actor) ?? []),
      author: this.toActor(issue.user),
      body: issue.body ?? null,
      closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
      labels: (issue.labels ?? []).map((label) => this.toLabel(label)),
      milestone: issue.milestone?.title ?? null,
      number: String(issue.number),
      providerCreatedAt: new Date(issue.created_at),
      providerIssueId: String(issue.id),
      providerUpdatedAt: new Date(issue.updated_at),
      state: issue.state === 'closed' ? 'CLOSED' : 'OPEN',
      title: issue.title,
      url: issue.html_url,
    };
  }

  /**
   * Normalize a provider pull request and its review, branch, and lifecycle metadata.
   *
   * @param pullRequest - Pull-request data being normalized, persisted, or used as an event source.
   * @returns The normalized pull request and its related metadata.
   */
  private toPullRequest(pullRequest: GitHubPullResponse): ProviderPullRequest {
    const mergedAt = pullRequest.merged_at ? new Date(pullRequest.merged_at) : null;
    return {
      assignees: (pullRequest.assignees ?? []).flatMap((actor) => this.toActor(actor) ?? []),
      author: this.toActor(pullRequest.user),
      body: pullRequest.body ?? null,
      closedAt: pullRequest.closed_at ? new Date(pullRequest.closed_at) : null,
      draft: pullRequest.draft ?? false,
      labels: (pullRequest.labels ?? []).map((label) => this.toLabel(label)),
      mergedAt,
      number: String(pullRequest.number),
      providerCreatedAt: new Date(pullRequest.created_at),
      providerPullRequestId: String(pullRequest.id),
      providerUpdatedAt: new Date(pullRequest.updated_at),
      sourceBranch: pullRequest.head.ref,
      state: mergedAt ? 'MERGED' : pullRequest.state === 'closed' ? 'CLOSED' : 'OPEN',
      targetBranch: pullRequest.base.ref,
      title: pullRequest.title,
      url: pullRequest.html_url,
    };
  }

  /**
   * Build the provider-specific authentication and content negotiation headers.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @returns Provider authentication and content negotiation headers.
   */
  private headers(context: ProviderAccountContext): HeadersInit {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${context.accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
  /**
   * Normalize provider repository identity, ownership, name, and URL.
   *
   * @param repository - Repository identity and metadata required by the operation.
   * @returns Normalized repository metadata.
   */
  private toRepository(repository: GitHubRepositoryResponse): ProviderRepository {
    return {
      providerRepositoryId: String(repository.id),
      owner: repository.owner.login,
      name: repository.name,
      url: repository.html_url,
    };
  }
  /**
   * Resolve a provider API path against the configured instance base URL.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @param path - Provider API path relative to the configured instance.
   * @returns The absolute provider API URL.
   */
  private url(context: ProviderAccountContext, path: string): string {
    return `${(context.baseUrl ?? 'https://api.github.com').replace(/\/$/, '')}${path}`;
  }

  /**
   * Preserve the pull-request execution context when GitHub omits it from the Actions run payload.
   *
   * GitHub can return an empty `pull_requests` array for historical pull-request runs after their branch is merged.
   * Looking up pull requests associated with the immutable head commit keeps the lookup read-only and lets a later
   * successful validation on the target branch retire the stale failure.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @param repository - Repository identity and metadata required by the operation.
   * @param run - Workflow run whose provider data or persisted state is being processed.
   * @returns The normalized current provider run.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  private async resolveWorkflowRun(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    run: GitHubWorkflowRunResponse,
  ): Promise<ProviderWorkflowRun> {
    if (
      run.event === 'pull_request' &&
      normalizeWorkflowRunStatus('GITHUB', run.status, run.conclusion) === 'FAILED' &&
      !run.pull_requests?.length &&
      run.head_sha
    ) {
      const pullRequests = await this.request<GitHubPullRequestResponse[]>(
        context,
        `/repos/${repository.owner}/${repository.name}/commits/${run.head_sha}/pulls?per_page=1`,
      );
      const pullRequest = pullRequests[0];
      if (pullRequest) run = { ...run, pull_requests: [{ number: pullRequest.number }] };
    }
    return this.toWorkflowRun(run, repository);
  }

  /**
   * Normalize a provider run, retaining lifecycle, timing, workflow identity, and change-request scope.
   *
   * @param run - Workflow run whose provider data or persisted state is being processed.
   * @param repository - Repository identity and metadata required by the operation.
   * @returns The normalized workflow run and its execution context.
   */
  private toWorkflowRun(run: GitHubWorkflowRunResponse, repository: ProviderRepositoryReference): ProviderWorkflowRun {
    const startedAt = run.run_started_at ? new Date(run.run_started_at) : null;
    const completedAt = run.status === 'completed' ? new Date(run.updated_at) : null;
    const changeRequestNumber = run.pull_requests?.[0]?.number?.toString() ?? null;
    const headBranch = run.head_branch ?? null;
    const workflowPath = run.path ?? null;
    const workflowKind = workflowPath === dependabotWorkflowPath ? 'DEPENDABOT_INTERNAL' : 'STANDARD';
    const workflowName = workflowKind === 'DEPENDABOT_INTERNAL' ? 'Dependabot Updates' : run.name;
    return {
      awaitingApproval: isWorkflowRunAwaitingApproval('GITHUB', run.status, run.conclusion),
      changeRequestNumber,
      displayTitle: run.display_title ?? run.name,
      event: run.event ?? null,
      headBranch,
      headSha: run.head_sha ?? null,
      providerRunId: String(run.id),
      providerWorkflowId: run.workflow_id ? String(run.workflow_id) : (workflowPath ?? `name:${workflowName}`),
      url: run.html_url,
      providerCreatedAt: new Date(run.created_at),
      startedAt,
      completedAt,
      durationMs: startedAt && completedAt ? completedAt.getTime() - startedAt.getTime() : null,
      status: normalizeWorkflowRunStatus('GITHUB', run.status, run.conclusion),
      rawStatus: run.conclusion ?? run.status,
      reviewUrl: this.githubPullRequestUrl(run, repository),
      scopeKey: buildWorkflowRunScopeKey(changeRequestNumber, headBranch),
      workflowKind,
      workflowName,
      workflowPath,
    };
  }

  /**
   * Extract the GitHub pull-request URL from a run when its first change request is present.
   *
   * @param run - Workflow run whose provider data or persisted state is being processed.
   * @param repository - Repository identity and metadata required by the operation.
   * @returns The first pull-request URL, or null when unavailable.
   */
  private githubPullRequestUrl(run: GitHubWorkflowRunResponse, repository: ProviderRepositoryReference): string | null {
    const pullRequestNumber = run.pull_requests?.[0]?.number;
    if (!pullRequestNumber) return null;
    return `${new URL(run.html_url).origin}/${repository.owner}/${repository.name}/pull/${pullRequestNumber}`;
  }
}
