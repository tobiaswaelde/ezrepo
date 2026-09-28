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
  ProviderWorkItemQuery,
  ProviderWorkflowRun,
  VerifiedWebhook,
} from '../provider-adapter.js';
import { PROVIDER_FETCH, buildWorkflowRunScopeKey, providerWebhookSyncScopes } from '../provider-adapter.js';
import { providerRequestError } from '../provider-request.error.js';
import { isWorkflowRunAwaitingApproval, normalizeWorkflowRunStatus } from '../workflow-status.js';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
interface GitLabProject {
  id: number;
  name: string;
  web_url: string;
  namespace: { full_path: string };
}
interface GitLabPipeline {
  id: number;
  status: string;
  web_url: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration: number | null;
  name?: string;
  ref?: string;
  sha?: string;
  source?: string;
  merge_request?: { iid: number };
}
interface GitLabMergeRequest {
  merged_at?: string | null;
  state: string;
  target_branch?: string;
}
interface GitLabActor {
  avatar_url?: string | null;
  id: number;
  name?: string | null;
  username: string;
  web_url?: string;
}
interface GitLabIssue {
  assignees?: GitLabActor[];
  author?: GitLabActor;
  closed_at?: string | null;
  created_at: string;
  description?: string | null;
  id: number;
  iid: number;
  labels?: string[];
  milestone?: { title: string } | null;
  state: string;
  title: string;
  updated_at: string;
  web_url: string;
}
interface GitLabLabel {
  color: string;
  description?: string | null;
  id: number;
  name: string;
}
interface GitLabPullRequestResponse extends GitLabIssue {
  draft?: boolean;
  merged_at?: string | null;
  source_branch: string;
  target_branch: string;
  work_in_progress?: boolean;
}

/** GitLab adapter that only reads projects and pipelines. */
@Injectable()
export class GitLabPipelinesAdapter implements ProviderAdapter {
  readonly providerType = 'GITLAB' as const;

  /**
   * Initialize GitLabPipelinesAdapter with its required dependencies.
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
    const user = await this.request<{ username: string }>(context, '/user');
    return { displayName: user.username, valid: true };
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
    const projects = await this.request<GitLabProject[]>(context, '/projects?membership=true&simple=true&per_page=100');
    return projects.map((project) => this.toRepository(project));
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
      this.url(
        context,
        `/projects/${encodeURIComponent(repository.providerRepositoryId)}/merge_requests/${changeRequestNumber}`,
      ),
      { headers: this.headers(context) },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw providerRequestError('GitLab', response);
    const mergeRequest = (await response.json()) as GitLabMergeRequest;
    const mergedAt = mergeRequest.merged_at ? new Date(mergeRequest.merged_at) : null;
    return {
      mergedAt,
      state:
        mergedAt || mergeRequest.state === 'merged' ? 'MERGED' : mergeRequest.state === 'closed' ? 'CLOSED' : 'OPEN',
      targetBranch: mergeRequest.target_branch ?? null,
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
    const response = await this.fetchFn(
      this.url(context, `/projects/${encodeURIComponent(repository.providerRepositoryId)}`),
      { headers: this.headers(context) },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw providerRequestError('GitLab', response);
    return this.toRepository((await response.json()) as GitLabProject);
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
    const parameters: Record<string, string> = { order_by: 'updated_at', sort: 'desc' };
    if (updatedAfter) parameters.updated_after = updatedAfter.toISOString();
    const pipelines = await this.listPages<GitLabPipeline>(
      context,
      `/projects/${encodeURIComponent(repository.providerRepositoryId)}/pipelines`,
      parameters,
    );
    return pipelines.map((pipeline) => this.toWorkflowRun(pipeline));
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
      this.url(context, `/projects/${encodeURIComponent(repository.providerRepositoryId)}/pipelines/${providerRunId}`),
      { headers: this.headers(context) },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw providerRequestError('GitLab', response);
    return this.toWorkflowRun((await response.json()) as GitLabPipeline);
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
    const path = `/projects/${encodeURIComponent(repository.providerRepositoryId)}/issues`;
    const [recent, open, labels] = await Promise.all([
      this.listPages<GitLabIssue>(context, path, {
        order_by: 'updated_at',
        sort: 'desc',
        state: 'all',
        updated_after: query.updatedAfter.toISOString(),
      }),
      query.includeAllOpen
        ? this.listPages<GitLabIssue>(context, path, { order_by: 'updated_at', sort: 'desc', state: 'opened' })
        : [],
      this.listProjectLabels(context, repository),
    ]);
    return this.uniqueById([...recent, ...open]).map((issue) => this.toIssue(issue, labels));
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
    const path = `/projects/${encodeURIComponent(repository.providerRepositoryId)}/merge_requests`;
    const [recent, open, labels] = await Promise.all([
      this.listPages<GitLabPullRequestResponse>(context, path, {
        order_by: 'updated_at',
        sort: 'desc',
        state: 'all',
        updated_after: query.updatedAfter.toISOString(),
      }),
      query.includeAllOpen
        ? this.listPages<GitLabPullRequestResponse>(context, path, {
            order_by: 'updated_at',
            sort: 'desc',
            state: 'opened',
          })
        : [],
      this.listProjectLabels(context, repository),
    ]);
    return this.uniqueById([...recent, ...open]).map((pullRequest) => this.toPullRequest(pullRequest, labels));
  }

  /**
   * Verify provider webhook authentication before returning its repository and synchronization scopes.
   *
   * @param request - Incoming request with the authentication or webhook context required by this endpoint.
   * @returns Verified event metadata and requested scopes, or null when authentication is invalid.
   * @throws SyntaxError - When an authenticated webhook body is not valid JSON.
   */
  async verifyWebhook(request: ProviderWebhookRequest): Promise<VerifiedWebhook | null> {
    const token = request.headers['x-gitlab-token'];
    const event = request.headers['x-gitlab-event'];
    if (typeof event !== 'string') return null;
    if (!this.hasValidWebhookSignature(request) && !this.hasValidLegacyToken(token, request.signingSecret)) return null;
    const payload = JSON.parse(Buffer.from(request.payload).toString('utf8')) as { project?: { id?: number } };
    return {
      event,
      providerRepositoryId: payload.project?.id ? String(payload.project.id) : null,
      syncScopes: providerWebhookSyncScopes(event),
    };
  }

  /**
   * Compare the legacy GitLab webhook token with the configured signing secret.
   *
   * @param token - Bearer token or provider credential; never included in diagnostic output.
   * @param signingSecret - Configured webhook secret used only for signature verification.
   * @returns Whether the supplied legacy token matches the signing secret.
   */
  private hasValidLegacyToken(token: string | string[] | undefined, signingSecret: string): boolean {
    return (
      typeof token === 'string' &&
      token.length === signingSecret.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(signingSecret))
    );
  }
  /**
   * Normalize provider repository identity, ownership, name, and URL.
   *
   * @param project - GitLab project metadata to normalize.
   * @returns Normalized repository metadata.
   */
  private toRepository(project: GitLabProject): ProviderRepository {
    return {
      providerRepositoryId: String(project.id),
      owner: project.namespace.full_path,
      name: project.name,
      url: project.web_url,
    };
  }
  /**
   * Validate the GitLab webhook signature using the signed delivery metadata and payload.
   *
   * @param request - Incoming request with the authentication or webhook context required by this endpoint.
   * @returns Whether the signed webhook metadata authenticates the payload.
   */
  private hasValidWebhookSignature(request: ProviderWebhookRequest): boolean {
    const signature = request.headers['webhook-signature'];
    const id = request.headers['webhook-id'];
    const timestamp = request.headers['webhook-timestamp'];
    if (
      typeof signature !== 'string' ||
      typeof id !== 'string' ||
      typeof timestamp !== 'string' ||
      !request.signingSecret.startsWith('whsec_')
    ) {
      return false;
    }

    const key = Buffer.from(request.signingSecret.slice('whsec_'.length), 'base64');
    const expected = `v1,${createHmac('sha256', key)
      .update(`${id}.${timestamp}.${Buffer.from(request.payload).toString('utf8')}`)
      .digest('base64')}`;
    return signature.split(' ').some((candidate) => this.hasEqualValue(candidate, expected));
  }
  /**
   * Compare equal-length webhook authentication values using constant-time comparison.
   *
   * @param value - Value to parse, validate, or normalize.
   * @param expected - Expected authentication value used for constant-time comparison.
   * @returns Whether both values have equal lengths and equal bytes.
   */
  private hasEqualValue(value: string, expected: string): boolean {
    return value.length === expected.length && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
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
    if (!response.ok) throw providerRequestError('GitLab', response);
    return (await response.json()) as T;
  }
  /**
   * Read provider pages until exhausted or the synchronization boundary is reached.
   *
   * @typeParam T - Provider record type preserved in the result.
   * @param context - Provider account credentials and instance configuration for this request.
   * @param path - Provider API path relative to the configured instance.
   * @param parameters - Query-string values sent with every page request.
   * @returns Accepted records collected across provider pages.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  private async listPages<T extends { id: number }>(
    context: ProviderAccountContext,
    path: string,
    parameters: Record<string, string>,
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({ ...parameters, page: String(page), per_page: '100' });
      const result = await this.request<T[]>(context, `${path}?${query}`);
      items.push(...result);
      if (result.length < 100) break;
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
   * Read project labels into a name-keyed lookup for work-item normalization.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @param repository - Repository identity and metadata required by the operation.
   * @returns Project labels indexed by their names.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  private async listProjectLabels(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference,
  ): Promise<Map<string, GitLabLabel>> {
    const labels = await this.listPages<GitLabLabel>(
      context,
      `/projects/${encodeURIComponent(repository.providerRepositoryId)}/labels`,
      { with_counts: 'false' },
    );
    return new Map(labels.map((label) => [label.name.toLocaleLowerCase('en-US'), label]));
  }
  /**
   * Normalize an optional provider actor without inventing a missing identity.
   *
   * @param actor - Optional provider user identity associated with a work item.
   * @returns The normalized actor, or null when no actor is supplied.
   */
  private toActor(actor: GitLabActor | null | undefined): ProviderActor | null {
    if (!actor) return null;
    return {
      avatarUrl: actor.avatar_url ?? null,
      displayName: actor.name ?? null,
      providerActorId: String(actor.id),
      url: actor.web_url ?? null,
      username: actor.username,
    };
  }
  /**
   * Normalize a provider issue and its author, assignees, labels, and lifecycle metadata.
   *
   * @param issue - Issue data being normalized, persisted, or used as an event source.
   * @param labels - Project label metadata indexed by label name.
   * @returns The normalized issue and its related metadata.
   */
  private toIssue(issue: GitLabIssue, labels: Map<string, GitLabLabel>): ProviderIssue {
    return {
      assignees: (issue.assignees ?? []).flatMap((actor) => this.toActor(actor) ?? []),
      author: this.toActor(issue.author),
      body: issue.description ?? null,
      closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
      labels: (issue.labels ?? []).map((name) => ({
        color: labels.get(name.toLocaleLowerCase('en-US'))?.color.replace(/^#/, '') ?? null,
        description: labels.get(name.toLocaleLowerCase('en-US'))?.description ?? null,
        name,
        providerLabelId: labels.get(name.toLocaleLowerCase('en-US'))?.id.toString() ?? null,
      })),
      milestone: issue.milestone?.title ?? null,
      number: String(issue.iid),
      providerCreatedAt: new Date(issue.created_at),
      providerIssueId: String(issue.id),
      providerUpdatedAt: new Date(issue.updated_at),
      state: issue.state === 'closed' ? 'CLOSED' : 'OPEN',
      title: issue.title,
      url: issue.web_url,
    };
  }
  /**
   * Normalize a provider pull request and its review, branch, and lifecycle metadata.
   *
   * @param pullRequest - Pull-request data being normalized, persisted, or used as an event source.
   * @param labels - Project label metadata indexed by label name.
   * @returns The normalized pull request and its related metadata.
   */
  private toPullRequest(pullRequest: GitLabPullRequestResponse, labels: Map<string, GitLabLabel>): ProviderPullRequest {
    const mergedAt = pullRequest.merged_at ? new Date(pullRequest.merged_at) : null;
    return {
      assignees: (pullRequest.assignees ?? []).flatMap((actor) => this.toActor(actor) ?? []),
      author: this.toActor(pullRequest.author),
      body: pullRequest.description ?? null,
      closedAt: pullRequest.closed_at ? new Date(pullRequest.closed_at) : null,
      draft: pullRequest.draft ?? pullRequest.work_in_progress ?? false,
      labels: (pullRequest.labels ?? []).map((name) => ({
        color: labels.get(name.toLocaleLowerCase('en-US'))?.color.replace(/^#/, '') ?? null,
        description: labels.get(name.toLocaleLowerCase('en-US'))?.description ?? null,
        name,
        providerLabelId: labels.get(name.toLocaleLowerCase('en-US'))?.id.toString() ?? null,
      })),
      mergedAt,
      number: String(pullRequest.iid),
      providerCreatedAt: new Date(pullRequest.created_at),
      providerPullRequestId: String(pullRequest.id),
      providerUpdatedAt: new Date(pullRequest.updated_at),
      sourceBranch: pullRequest.source_branch,
      state: mergedAt || pullRequest.state === 'merged' ? 'MERGED' : pullRequest.state === 'closed' ? 'CLOSED' : 'OPEN',
      targetBranch: pullRequest.target_branch,
      title: pullRequest.title,
      url: pullRequest.web_url,
    };
  }
  /**
   * Build the provider-specific authentication and content negotiation headers.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @returns Provider authentication and content negotiation headers.
   */
  private headers(context: ProviderAccountContext): HeadersInit {
    return { Accept: 'application/json', Authorization: `Bearer ${context.accessToken}` };
  }
  /**
   * Resolve a provider API path against the configured instance base URL.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @param path - Provider API path relative to the configured instance.
   * @returns The absolute provider API URL.
   */
  private url(context: ProviderAccountContext, path: string): string {
    const baseUrl = (context.baseUrl ?? 'https://gitlab.com').replace(/\/$/, '');
    return `${baseUrl.endsWith('/api/v4') ? baseUrl : `${baseUrl}/api/v4`}${path}`;
  }
  /**
   * Normalize a provider run, retaining lifecycle, timing, workflow identity, and change-request scope.
   *
   * @param pipeline - GitLab pipeline whose workflow or merge-request metadata is needed.
   * @returns The normalized workflow run and its execution context.
   */
  private toWorkflowRun(pipeline: GitLabPipeline): ProviderWorkflowRun {
    const startedAt = pipeline.started_at ? new Date(pipeline.started_at) : null;
    const completedAt = pipeline.finished_at ? new Date(pipeline.finished_at) : null;
    const changeRequestNumber = this.gitLabMergeRequestNumber(pipeline)?.toString() ?? null;
    const headBranch = pipeline.ref ?? null;
    const workflowName = pipeline.name ?? 'Pipeline';
    return {
      awaitingApproval: isWorkflowRunAwaitingApproval('GITLAB', pipeline.status),
      changeRequestNumber,
      displayTitle: pipeline.name ?? pipeline.ref ?? 'Pipeline',
      event: pipeline.source ?? null,
      headBranch,
      headSha: pipeline.sha ?? null,
      providerRunId: String(pipeline.id),
      providerWorkflowId: pipeline.name ? `name:${pipeline.name}` : 'pipeline',
      url: pipeline.web_url,
      providerCreatedAt: new Date(pipeline.created_at),
      startedAt,
      completedAt,
      durationMs:
        pipeline.duration === null
          ? startedAt && completedAt
            ? completedAt.getTime() - startedAt.getTime()
            : null
          : pipeline.duration * 1000,
      status: normalizeWorkflowRunStatus('GITLAB', pipeline.status),
      rawStatus: pipeline.status,
      reviewUrl: this.gitLabMergeRequestUrl(pipeline),
      scopeKey: buildWorkflowRunScopeKey(changeRequestNumber, headBranch),
      workflowKind: 'STANDARD',
      workflowName,
      workflowPath: null,
    };
  }

  /**
   * Construct the merge-request URL from a pipeline merge-request ref.
   *
   * @param pipeline - GitLab pipeline whose workflow or merge-request metadata is needed.
   * @returns The merge-request URL, or null when the ref is not a merge-request ref.
   */
  private gitLabMergeRequestUrl(pipeline: GitLabPipeline): string | null {
    const mergeRequestIid = this.gitLabMergeRequestNumber(pipeline);
    if (!mergeRequestIid) return null;
    return pipeline.web_url.replace(/\/-\/pipelines\/\d+(?:\/)?$/, `/-/merge_requests/${mergeRequestIid}`);
  }

  /**
   * Extract the merge-request number from a GitLab pipeline ref.
   *
   * @param pipeline - GitLab pipeline whose workflow or merge-request metadata is needed.
   * @returns The extracted merge-request number, or null for other refs.
   */
  private gitLabMergeRequestNumber(pipeline: GitLabPipeline): number | null {
    const refMatch = pipeline.ref?.match(/^refs\/merge-requests\/(\d+)\/head$/);
    return pipeline.merge_request?.iid ?? (refMatch ? Number(refMatch[1]) : null);
  }
}
