import type { ProviderActor, ProviderIssue, ProviderPullRequest, ProviderWorkItemLabel } from '../provider-adapter.js';

/** Gitea-compatible user embedded in issue and pull-request responses. */
export interface GiteaWorkItemActor {
  avatar_url?: string;
  full_name?: string;
  html_url?: string;
  id: number;
  login: string;
}

/** Gitea-compatible label embedded in work-item responses. */
export interface GiteaWorkItemLabel {
  color?: string;
  description?: string | null;
  id?: number;
  name: string;
}

/** Gitea-compatible issue response shared with Forgejo. */
export interface GiteaIssueResponse {
  assignees?: GiteaWorkItemActor[];
  body?: string | null;
  closed_at?: string | null;
  created_at: string;
  html_url: string;
  id: number;
  labels?: GiteaWorkItemLabel[];
  milestone?: { title: string } | null;
  number: number;
  pull_request?: unknown;
  state: string;
  title: string;
  updated_at: string;
  user?: GiteaWorkItemActor | null;
}

/** Gitea-compatible pull-request response shared with Forgejo. */
export interface GiteaPullRequestResponse extends GiteaIssueResponse {
  base: { ref: string };
  draft?: boolean;
  head: { ref: string };
  merged?: boolean;
  merged_at?: string | null;
}

function toActor(actor: GiteaWorkItemActor | null | undefined): ProviderActor | null {
  if (!actor) return null;
  return {
    avatarUrl: actor.avatar_url ?? null,
    displayName: actor.full_name || null,
    providerActorId: String(actor.id),
    url: actor.html_url ?? null,
    username: actor.login,
  };
}

function toLabel(label: GiteaWorkItemLabel): ProviderWorkItemLabel {
  return {
    color: label.color ?? null,
    description: label.description ?? null,
    name: label.name,
    providerLabelId: label.id === undefined ? null : String(label.id),
  };
}

/** Normalize one Gitea-compatible issue response. */
export function toProviderIssue(issue: GiteaIssueResponse): ProviderIssue {
  return {
    assignees: (issue.assignees ?? []).flatMap((actor) => toActor(actor) ?? []),
    author: toActor(issue.user),
    body: issue.body ?? null,
    closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
    labels: (issue.labels ?? []).map(toLabel),
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

/** Normalize one Gitea-compatible pull or merge request response. */
export function toProviderPullRequest(pullRequest: GiteaPullRequestResponse): ProviderPullRequest {
  const mergedAt = pullRequest.merged_at ? new Date(pullRequest.merged_at) : null;
  return {
    assignees: (pullRequest.assignees ?? []).flatMap((actor) => toActor(actor) ?? []),
    author: toActor(pullRequest.user),
    body: pullRequest.body ?? null,
    closedAt: pullRequest.closed_at ? new Date(pullRequest.closed_at) : null,
    draft: pullRequest.draft ?? false,
    labels: (pullRequest.labels ?? []).map(toLabel),
    mergedAt,
    number: String(pullRequest.number),
    providerCreatedAt: new Date(pullRequest.created_at),
    providerPullRequestId: String(pullRequest.id),
    providerUpdatedAt: new Date(pullRequest.updated_at),
    sourceBranch: pullRequest.head.ref,
    state: pullRequest.merged || mergedAt ? 'MERGED' : pullRequest.state === 'closed' ? 'CLOSED' : 'OPEN',
    targetBranch: pullRequest.base.ref,
    title: pullRequest.title,
    url: pullRequest.html_url,
  };
}
