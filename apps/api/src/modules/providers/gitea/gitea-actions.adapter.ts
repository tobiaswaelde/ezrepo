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

  constructor(@Inject(PROVIDER_FETCH) private readonly fetchFn: FetchLike = fetch) {}

  async validateAccount(context: ProviderAccountContext): Promise<ProviderAccountValidation> {
    const user = await this.request<{ login: string }>(context, '/user');
    return { displayName: user.login, valid: true };
  }

  async listRepositories(context: ProviderAccountContext): Promise<ProviderRepository[]> {
    const repositories = await this.request<GiteaRepository[]>(context, '/user/repos?limit=100');
    return repositories.map((repository) => this.toRepository(repository));
  }

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

  private async request<T>(context: ProviderAccountContext, path: string): Promise<T> {
    const response = await this.fetchFn(this.url(context, path), { headers: this.headers(context) });
    if (!response.ok) throw providerRequestError('Gitea', response);
    return (await response.json()) as T;
  }

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

  private uniqueById<T extends { id: number }>(items: T[]): T[] {
    return [...new Map(items.map((item) => [item.id, item])).values()];
  }

  private async actionsRequest<T>(context: ProviderAccountContext, path: string): Promise<T> {
    const response = await this.fetchFn(this.url(context, path), { headers: this.headers(context) });
    if (response.status === 404) throw new GiteaActionsUnsupportedError();
    if (!response.ok) throw providerRequestError('Gitea', response);
    return (await response.json()) as T;
  }

  private headers(context: ProviderAccountContext): HeadersInit {
    return { Accept: 'application/json', Authorization: `token ${context.accessToken}` };
  }

  private toRepository(repository: GiteaRepository): ProviderRepository {
    return {
      name: repository.name,
      owner: repository.owner.login,
      providerRepositoryId: String(repository.id),
      url: repository.html_url,
    };
  }

  private url(context: ProviderAccountContext, path: string): string {
    const baseUrl = (context.baseUrl ?? '').replace(/\/$/, '');
    return `${baseUrl.endsWith('/api/v1') ? baseUrl : `${baseUrl}/api/v1`}${path}`;
  }

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
