import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  ProviderAccountContext,
  ProviderAccountValidation,
  ProviderAdapter,
  ProviderChangeRequestState,
  ProviderIssue,
  ProviderPullRequest,
  ProviderRepository,
  ProviderRepositoryReference,
  ProviderWebhookRequest,
  ProviderWorkItemQuery,
  ProviderWorkflowRun,
  VerifiedWebhook,
} from '../provider-adapter.js';
import { PROVIDER_FETCH, buildWorkflowRunScopeKey, providerWebhookSyncScopes } from '../provider-adapter.js';
import { providerRequestError } from '../provider-request.error.js';
import { isWorkflowRunAwaitingApproval, normalizeWorkflowRunStatus } from '../workflow-status.js';
import {
  type GiteaIssueResponse,
  type GiteaPullRequestResponse,
  toProviderIssue,
  toProviderPullRequest,
} from './work-items.js';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface GiteaRepository {
  html_url: string;
  id: number;
  name: string;
  owner: { login: string };
}

interface GiteaWorkflowRun {
  completed_at?: string | null;
  conclusion?: string | null;
  created_at: string;
  event?: string;
  head_branch?: string | null;
  head_sha?: string | null;
  html_url: string;
  id: number;
  name?: string;
  path?: string;
  pull_requests?: { number: number }[];
  run_started_at?: string | null;
  status: string;
  updated_at: string;
  workflow_name?: string;
  workflow_id?: number | string;
}

interface GiteaWorkflowRunsResponse {
  total_count?: number;
  workflow_runs?: GiteaWorkflowRun[];
}

interface GiteaPullRequest {
  base?: { ref?: string };
  merged?: boolean;
  merged_at?: string | null;
  state: string;
}

/** Raised when a Gitea instance does not expose the read-only Actions run API. */
export class GiteaActionsUnsupportedError extends Error {
  /**
   * Initialize the GiteaActionsUnsupportedError with its failure context.
   *
   *
   */
  constructor() {
    super(
      'This Gitea server does not expose the Actions workflow-run API. Upgrade Gitea or disable Actions synchronization for this account.',
    );
  }
}

/** Gitea adapter for read-only repository and Actions workflow-run synchronization. */
@Injectable()
export class GiteaActionsAdapter implements ProviderAdapter {
  readonly providerType = 'GITEA' as const;

  /**
   * Initialize GiteaActionsAdapter with its required dependencies.
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
    const user = await this.request<{ login: string }>(context, '/user');
    return { displayName: user.login, valid: true };
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
    const repositories = await this.request<GiteaRepository[]>(context, '/user/repos?limit=100');
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
    if (!response.ok) throw providerRequestError('Gitea', response);
    const pullRequest = (await response.json()) as GiteaPullRequest;
    const mergedAt = pullRequest.merged_at ? new Date(pullRequest.merged_at) : null;
    return {
      mergedAt,
      state: pullRequest.merged || mergedAt ? 'MERGED' : pullRequest.state === 'closed' ? 'CLOSED' : 'OPEN',
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
    const response = await this.fetchFn(this.url(context, `/repositories/${repository.providerRepositoryId}`), {
      headers: this.headers(context),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw providerRequestError('Gitea', response);
    return this.toRepository((await response.json()) as GiteaRepository);
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
   * @throws GiteaActionsUnsupportedError - When the instance does not expose the Actions workflow-run endpoint.
   */
  async listWorkflowRuns(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    updatedAfter?: Date,
  ): Promise<ProviderWorkflowRun[]> {
    const runs: GiteaWorkflowRun[] = [];
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({ limit: '100', page: String(page) });
      const data = await this.actionsRequest<GiteaWorkflowRunsResponse>(
        context,
        `/repos/${repository.owner}/${repository.name}/actions/runs?${query}`,
      );
      const pageRuns = data.workflow_runs ?? [];
      const recentRuns = updatedAfter ? pageRuns.filter((run) => new Date(run.updated_at) >= updatedAfter) : pageRuns;
      runs.push(...recentRuns);

      const totalCountAllowsAnotherPage = data.total_count === undefined || page * 100 < data.total_count;
      const reachedSynchronizationBoundary = Boolean(updatedAfter) && recentRuns.length < pageRuns.length;
      if (pageRuns.length < 100 || !totalCountAllowsAnotherPage || reachedSynchronizationBoundary) break;
    }
    return runs.map((run) => this.toWorkflowRun(run));
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
    if (!response.ok) throw providerRequestError('Gitea', response);
    return this.toWorkflowRun((await response.json()) as GiteaWorkflowRun);
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
    const recent = await this.listPages<GiteaIssueResponse>(context, path, {
      since: query.updatedAfter.toISOString(),
      state: 'all',
      type: 'issues',
    });
    const open = query.includeAllOpen
      ? await this.listPages<GiteaIssueResponse>(context, path, { state: 'open', type: 'issues' })
      : [];
    return this.uniqueById([...recent, ...open])
      .filter((issue) => !issue.pull_request)
      .map(toProviderIssue);
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
    const recent = await this.listPages<GiteaPullRequestResponse>(
      context,
      path,
      { sort: 'recentupdate', state: 'all' },
      (pullRequest) => new Date(pullRequest.updated_at) >= query.updatedAfter,
    );
    const open = query.includeAllOpen
      ? await this.listPages<GiteaPullRequestResponse>(context, path, { sort: 'recentupdate', state: 'open' })
      : [];
    return this.uniqueById([...recent, ...open]).map(toProviderPullRequest);
  }

  /**
   * Verify provider webhook authentication before returning its repository and synchronization scopes.
   *
   * @param request - Incoming request with the authentication or webhook context required by this endpoint.
   * @returns Verified event metadata and requested scopes, or null when authentication is invalid.
   * @throws SyntaxError - When an authenticated webhook body is not valid JSON.
   */
  async verifyWebhook(request: ProviderWebhookRequest): Promise<VerifiedWebhook | null> {
    const signature = request.headers['x-gitea-signature'];
    const event = request.headers['x-gitea-event'];
    if (typeof signature !== 'string' || typeof event !== 'string') return null;

    const expected = createHmac('sha256', request.signingSecret).update(request.payload).digest('hex');
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
    if (!response.ok) throw providerRequestError('Gitea', response);
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
      const query = new URLSearchParams({ ...parameters, limit: '100', page: String(page) });
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
   * Read the Actions API and distinguish unsupported instances from other provider failures.
   *
   * @typeParam T - Expected decoded provider response shape.
   * @param context - Provider account credentials and instance configuration for this request.
   * @param path - Provider API path relative to the configured instance.
   * @returns The decoded Actions API response.
   * @throws GiteaActionsUnsupportedError - When the instance does not expose the Actions workflow-run endpoint.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  private async actionsRequest<T>(context: ProviderAccountContext, path: string): Promise<T> {
    const response = await this.fetchFn(this.url(context, path), { headers: this.headers(context) });
    if (response.status === 404) throw new GiteaActionsUnsupportedError();
    if (!response.ok) throw providerRequestError('Gitea', response);
    return (await response.json()) as T;
  }

  /**
   * Build the provider-specific authentication and content negotiation headers.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @returns Provider authentication and content negotiation headers.
   */
  private headers(context: ProviderAccountContext): HeadersInit {
    return { Accept: 'application/json', Authorization: `token ${context.accessToken}` };
  }

  /**
   * Normalize provider repository identity, ownership, name, and URL.
   *
   * @param repository - Repository identity and metadata required by the operation.
   * @returns Normalized repository metadata.
   */
  private toRepository(repository: GiteaRepository): ProviderRepository {
    return {
      name: repository.name,
      owner: repository.owner.login,
      providerRepositoryId: String(repository.id),
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
    const baseUrl = (context.baseUrl ?? '').replace(/\/$/, '');
    return `${baseUrl.endsWith('/api/v1') ? baseUrl : `${baseUrl}/api/v1`}${path}`;
  }

  /**
   * Normalize a provider run, retaining lifecycle, timing, workflow identity, and change-request scope.
   *
   * @param run - Workflow run whose provider data or persisted state is being processed.
   * @returns The normalized workflow run and its execution context.
   */
  private toWorkflowRun(run: GiteaWorkflowRun): ProviderWorkflowRun {
    const startedAt = run.run_started_at ? new Date(run.run_started_at) : null;
    const completedAt = run.completed_at
      ? new Date(run.completed_at)
      : run.status === 'completed'
        ? new Date(run.updated_at)
        : null;
    const changeRequestNumber = run.pull_requests?.[0]?.number?.toString() ?? null;
    const headBranch = run.head_branch ?? null;
    const workflowName = run.workflow_name ?? run.name ?? 'Workflow';
    const workflowPath = run.path ?? null;
    return {
      awaitingApproval: isWorkflowRunAwaitingApproval('GITEA', run.status, run.conclusion ?? null),
      changeRequestNumber,
      completedAt,
      displayTitle: run.name ?? workflowName,
      durationMs: startedAt && completedAt ? completedAt.getTime() - startedAt.getTime() : null,
      event: run.event ?? null,
      headBranch,
      headSha: run.head_sha ?? null,
      providerCreatedAt: new Date(run.created_at),
      providerRunId: String(run.id),
      providerWorkflowId: run.workflow_id ? String(run.workflow_id) : (workflowPath ?? `name:${workflowName}`),
      rawStatus: run.conclusion ?? run.status,
      reviewUrl: null,
      scopeKey: buildWorkflowRunScopeKey(changeRequestNumber, headBranch),
      startedAt,
      status: normalizeWorkflowRunStatus('GITEA', run.status, run.conclusion ?? null),
      url: run.html_url,
      workflowKind: 'STANDARD',
      workflowName,
      workflowPath,
    };
  }
}
