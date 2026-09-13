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

  constructor(@Inject(PROVIDER_FETCH) private readonly fetchFn: FetchLike = fetch) {}

  async validateAccount(context: ProviderAccountContext): Promise<ProviderAccountValidation> {
    const user = await this.request<{ login: string }>(context, '/user');
    return { displayName: user.login, valid: true };
  }

  async listRepositories(context: ProviderAccountContext): Promise<ProviderRepository[]> {
    const repositories = await this.request<ForgejoRepository[]>(context, '/user/repos?page=1&limit=100');
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
    if (!response.ok) throw providerRequestError('Forgejo', response);
    const pullRequest = (await response.json()) as ForgejoPullRequest;
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
    if (!response.ok) throw providerRequestError('Forgejo', response);
    return this.toRepository((await response.json()) as ForgejoRepository);
  }

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

  private async request<T>(context: ProviderAccountContext, path: string): Promise<T> {
    const response = await this.fetchFn(this.url(context, path), { headers: this.headers(context) });
    if (!response.ok) throw providerRequestError('Forgejo', response);
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
      const query = new URLSearchParams({ ...parameters, limit: String(FORGEJO_PAGE_SIZE), page: String(page) });
      const result = await this.request<T[]>(context, `${path}?${query}`);
      items.push(...result.filter(keepReading));
      if (result.length < FORGEJO_PAGE_SIZE || (result.length > 0 && !keepReading(result[result.length - 1]!))) break;
    }
    return items;
  }

  private uniqueById<T extends { id: number }>(items: T[]): T[] {
    return [...new Map(items.map((item) => [item.id, item])).values()];
  }

  private async actionsRequest<T>(context: ProviderAccountContext, path: string): Promise<T> {
    const response = await this.fetchFn(this.url(context, path), { headers: this.headers(context) });
    if (response.status === 404) throw new ForgejoActionsUnsupportedError();
    if (!response.ok) throw providerRequestError('Forgejo', response);
    return (await response.json()) as T;
  }

  private headers(context: ProviderAccountContext): HeadersInit {
    return { Accept: 'application/json', Authorization: `token ${context.accessToken}` };
  }

  private toRepository(repository: ForgejoRepository): ProviderRepository {
    return {
      providerRepositoryId: String(repository.id),
      owner: repository.owner.login,
      name: repository.name,
      url: repository.html_url,
    };
  }

  private url(context: ProviderAccountContext, path: string): string {
    const baseUrl = (context.baseUrl ?? '').replace(/\/$/, '');
    return `${baseUrl.endsWith('/api/v1') ? baseUrl : `${baseUrl}/api/v1`}${path}`;
  }

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

  private parseEventPayload(value: string | undefined): ForgejoRunEventPayload {
    if (!value) return {};
    try {
      return JSON.parse(value) as ForgejoRunEventPayload;
    } catch {
      return {};
    }
  }
}
