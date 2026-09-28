import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  type GiteaIssueResponse,
  type GiteaPullRequestResponse,
  toProviderIssue,
  toProviderPullRequest,
} from '../gitea/work-items.js';
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
import { normalizeWorkflowRunStatus } from '../workflow-status.js';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const FORGEJO_PAGE_SIZE = 100;

interface ForgejoRepository {
  id: number;
  name: string;
  html_url: string;
  owner: { login: string };
}

interface ForgejoRun {
  approved_by?: number;
  commit_sha?: string;
  created: string;
  duration?: number;
  event?: string;
  event_payload?: string;
  html_url: string;
  id: number;
  need_approval?: boolean;
  prettyref?: string;
  started?: string | null;
  status: string;
  stopped?: string | null;
  title?: string;
  trigger_event?: string;
  updated: string;
  workflow_id?: string;
}

interface ForgejoRunEventPayload {
  number?: number;
  pull_request?: {
    head?: { ref?: string };
    html_url?: string;
    number?: number;
  };
}

interface ForgejoWorkflowRunsResponse {
  total_count?: number;
  workflow_runs?: ForgejoRun[];
}

interface ForgejoPullRequest {
  base?: { ref?: string };
  merged?: boolean;
  merged_at?: string | null;
  state: string;
}

/** Raised when a Forgejo instance predates the read-only Actions run API. */
export class ForgejoActionsUnsupportedError extends Error {
  /**
   * Initialize the ForgejoActionsUnsupportedError with its failure context.
   *
   *
   */
  constructor() {
    super(
      'This Forgejo server does not expose the Actions workflow-run API. Upgrade Forgejo or disable Actions synchronization for this account.',
    );
  }
}

/** Forgejo adapter for read-only repository and Actions workflow-run synchronization. */
@Injectable()
export class ForgejoActionsAdapter implements ProviderAdapter {
  readonly providerType = 'FORGEJO' as const;

  /**
   * Initialize ForgejoActionsAdapter with its required dependencies.
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
    const repositories = await this.request<ForgejoRepository[]>(context, '/user/repos?page=1&limit=100');
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
    if (!response.ok) throw providerRequestError('Forgejo', response);
    const pullRequest = (await response.json()) as ForgejoPullRequest;
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
    if (!response.ok) throw providerRequestError('Forgejo', response);
    return this.toRepository((await response.json()) as ForgejoRepository);
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
   * @throws ForgejoActionsUnsupportedError - When the instance does not expose the Actions workflow-run endpoint.
   */
  async listWorkflowRuns(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
    updatedAfter?: Date,
  ): Promise<ProviderWorkflowRun[]> {
    const runs: ForgejoRun[] = [];
    let page = 1;
    let hasMoreRecentRuns: boolean;

    do {
      const query = new URLSearchParams({ page: String(page), limit: String(FORGEJO_PAGE_SIZE) });
      const data = await this.actionsRequest<ForgejoWorkflowRunsResponse>(
        context,
        `/repos/${repository.owner}/${repository.name}/actions/runs?${query}`,
      );
      const pageRuns = data.workflow_runs ?? [];
      const recentRuns = updatedAfter
        ? pageRuns.filter((run) => new Date(run.updated ?? run.created) >= updatedAfter)
        : pageRuns;
      runs.push(...recentRuns);

      const totalCountAllowsAnotherPage = data.total_count === undefined || page * FORGEJO_PAGE_SIZE < data.total_count;
      hasMoreRecentRuns =
        pageRuns.length === FORGEJO_PAGE_SIZE && recentRuns.length === pageRuns.length && totalCountAllowsAnotherPage;
      page += 1;
    } while (hasMoreRecentRuns);

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
    if (!response.ok) throw providerRequestError('Forgejo', response);
    return this.toWorkflowRun((await response.json()) as ForgejoRun);
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
    const signature = request.headers['x-forgejo-signature'] ?? request.headers['x-gitea-signature'];
    const event = request.headers['x-forgejo-event'] ?? request.headers['x-gitea-event'];
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
    if (!response.ok) throw providerRequestError('Forgejo', response);
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
      const query = new URLSearchParams({ ...parameters, limit: String(FORGEJO_PAGE_SIZE), page: String(page) });
      const result = await this.request<T[]>(context, `${path}?${query}`);
      items.push(...result.filter(keepReading));
      if (result.length < FORGEJO_PAGE_SIZE || (result.length > 0 && !keepReading(result[result.length - 1]!))) break;
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
   * @throws ForgejoActionsUnsupportedError - When the instance does not expose the Actions workflow-run endpoint.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  private async actionsRequest<T>(context: ProviderAccountContext, path: string): Promise<T> {
    const response = await this.fetchFn(this.url(context, path), { headers: this.headers(context) });
    if (response.status === 404) throw new ForgejoActionsUnsupportedError();
    if (!response.ok) throw providerRequestError('Forgejo', response);
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
  private toRepository(repository: ForgejoRepository): ProviderRepository {
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
    const baseUrl = (context.baseUrl ?? '').replace(/\/$/, '');
    return `${baseUrl.endsWith('/api/v1') ? baseUrl : `${baseUrl}/api/v1`}${path}`;
  }

  /**
   * Normalize a provider run, retaining lifecycle, timing, workflow identity, and change-request scope.
   *
   * @param run - Workflow run whose provider data or persisted state is being processed.
   * @returns The normalized workflow run and its execution context.
   */
  private toWorkflowRun(run: ForgejoRun): ProviderWorkflowRun {
    const payload = this.parseEventPayload(run.event_payload);
    const event = run.trigger_event ?? run.event ?? null;
    const startedAt = run.started ? new Date(run.started) : null;
    const completedAt = run.stopped ? new Date(run.stopped) : null;
    const changeRequestNumber =
      (payload.pull_request?.number ?? (event?.startsWith('pull_request') ? payload.number : undefined))?.toString() ??
      null;
    const headBranch = payload.pull_request?.head?.ref ?? run.prettyref ?? null;
    const workflowId = run.workflow_id ?? 'unknown-workflow';
    const workflowName = workflowId.replace(/\.ya?ml$/i, '') || 'Workflow';
    const workflowPath = `.forgejo/workflows/${workflowId}`;
    const awaitingApproval = run.need_approval === true;
    return {
      awaitingApproval,
      changeRequestNumber,
      displayTitle: run.title ?? workflowName,
      event,
      headBranch,
      headSha: run.commit_sha ?? null,
      providerRunId: String(run.id),
      providerWorkflowId: workflowId,
      url: run.html_url,
      providerCreatedAt: new Date(run.created),
      startedAt,
      completedAt,
      durationMs:
        startedAt && completedAt
          ? completedAt.getTime() - startedAt.getTime()
          : run.duration === undefined
            ? null
            : run.duration / 1_000_000,
      status: normalizeWorkflowRunStatus('FORGEJO', run.status),
      rawStatus: run.status,
      reviewUrl: awaitingApproval ? run.html_url : null,
      scopeKey: buildWorkflowRunScopeKey(changeRequestNumber, headBranch),
      workflowKind: 'STANDARD',
      workflowName,
      workflowPath,
    };
  }

  /**
   * Decode a Forgejo event payload, falling back to an empty object for missing or invalid JSON.
   *
   * @param value - Value to parse, validate, or normalize.
   * @returns The decoded event payload, or an empty object if missing or malformed.
   */
  private parseEventPayload(value: string | undefined): ForgejoRunEventPayload {
    if (!value) return {};
    try {
      return JSON.parse(value) as ForgejoRunEventPayload;
    } catch {
      return {};
    }
  }
}
