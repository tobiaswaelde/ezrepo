import { Injectable } from '@nestjs/common';

import { NotificationEventType, type PullRequestWorkflowStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type {
  ProviderAccountContext,
  ProviderActor,
  ProviderAdapter,
  ProviderIssue,
  ProviderPullRequest,
  ProviderRepositoryReference,
  ProviderSyncScope,
  ProviderWorkItemLabel,
} from './provider-adapter.js';
import type { RepositorySyncProgressReporter } from './sync-progress.js';

const initialHistoryMs = 90 * 24 * 60 * 60 * 1_000;
const cursorOverlapMs = 5 * 60 * 1_000;

type SyncRepository = ProviderRepositoryReference & { id: string; providerAccountId: string };

/** Classify persisted issue state changes into global notification events. */
export function issueLifecycleEvents(
  previousState: 'OPEN' | 'CLOSED' | null,
  state: 'OPEN' | 'CLOSED',
  createdAfterCursor: boolean,
): NotificationEventType[] {
  if (previousState === state) return [];
  if (previousState === null) {
    return [
      ...(createdAfterCursor ? [NotificationEventType.ISSUE_OPENED] : []),
      ...(state === 'CLOSED' ? [NotificationEventType.ISSUE_CLOSED] : []),
    ];
  }
  return [state === 'OPEN' ? NotificationEventType.ISSUE_REOPENED : NotificationEventType.ISSUE_CLOSED];
}

/** Classify persisted pull-request state changes into global notification events. */
export function pullRequestLifecycleEvents(
  previousState: 'OPEN' | 'CLOSED' | 'MERGED' | null,
  state: 'OPEN' | 'CLOSED' | 'MERGED',
  createdAfterCursor: boolean,
): NotificationEventType[] {
  if (previousState === state) return [];
  if (previousState === null) {
    return [
      ...(createdAfterCursor ? [NotificationEventType.PULL_REQUEST_OPENED] : []),
      ...(state === 'MERGED'
        ? [NotificationEventType.PULL_REQUEST_MERGED]
        : state === 'CLOSED'
          ? [NotificationEventType.PULL_REQUEST_CLOSED]
          : []),
    ];
  }
  return [
    state === 'OPEN'
      ? NotificationEventType.PULL_REQUEST_REOPENED
      : state === 'MERGED'
        ? NotificationEventType.PULL_REQUEST_MERGED
        : NotificationEventType.PULL_REQUEST_CLOSED,
  ];
}

/** Synchronizes normalized issue and pull-request data for one tracked repository. */
@Injectable()
export class WorkItemSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Synchronize issue and pull-request domains with independent durable cursors. */
  async synchronize(
    context: ProviderAccountContext,
    repository: SyncRepository,
    adapter: ProviderAdapter,
    scopes: ProviderSyncScope[] = ['ISSUES', 'PULL_REQUESTS'],
    reportProgress?: RepositorySyncProgressReporter,
  ): Promise<void> {
    if (scopes.includes('ISSUES')) await this.synchronizeIssues(context, repository, adapter, reportProgress);
    if (scopes.includes('PULL_REQUESTS'))
      await this.synchronizePullRequests(context, repository, adapter, reportProgress);
  }

  private async synchronizeIssues(
    context: ProviderAccountContext,
    repository: SyncRepository,
    adapter: ProviderAdapter,
    reportProgress?: RepositorySyncProgressReporter,
  ): Promise<void> {
    await reportProgress?.({ current: null, phase: 'SYNCING_ISSUES', total: null });
    const { baseline, previousSynchronizedThrough, query, synchronizedThrough } = await this.syncWindow(
      repository.id,
      'ISSUE',
    );
    const issues = await adapter.listIssues(context, repository, query);
    await reportProgress?.({ current: 0, phase: 'SYNCING_ISSUES', total: issues.length });
    for (const [index, issue] of issues.entries()) {
      await this.persistIssue(repository, issue, baseline, previousSynchronizedThrough);
      await reportProgress?.({ current: index + 1, phase: 'SYNCING_ISSUES', total: issues.length });
    }
    await this.advanceCursor(repository.id, 'ISSUE', synchronizedThrough);
  }

  private async synchronizePullRequests(
    context: ProviderAccountContext,
    repository: SyncRepository,
    adapter: ProviderAdapter,
    reportProgress?: RepositorySyncProgressReporter,
  ): Promise<void> {
    await reportProgress?.({ current: null, phase: 'SYNCING_PULL_REQUESTS', total: null });
    const { baseline, previousSynchronizedThrough, query, synchronizedThrough } = await this.syncWindow(
      repository.id,
      'PULL_REQUEST',
    );
    const pullRequests = await adapter.listPullRequests(context, repository, query);
    await reportProgress?.({ current: 0, phase: 'SYNCING_PULL_REQUESTS', total: pullRequests.length });
    for (const [index, pullRequest] of pullRequests.entries()) {
      await this.persistPullRequest(repository, pullRequest, baseline, previousSynchronizedThrough);
      await reportProgress?.({ current: index + 1, phase: 'SYNCING_PULL_REQUESTS', total: pullRequests.length });
    }
    await this.advanceCursor(repository.id, 'PULL_REQUEST', synchronizedThrough);
  }

  private async syncWindow(repositoryId: string, kind: 'ISSUE' | 'PULL_REQUEST') {
    const synchronizedThrough = new Date();
    const cursor = await this.prisma.workItemSyncCursor.findUnique({
      where: { repositoryId_kind: { kind, repositoryId } },
    });
    return {
      baseline: !cursor,
      previousSynchronizedThrough: cursor?.synchronizedThrough ?? null,
      query: {
        includeAllOpen: !cursor?.synchronizedThrough,
        updatedAfter: new Date(
          cursor?.synchronizedThrough
            ? cursor.synchronizedThrough.getTime() - cursorOverlapMs
            : synchronizedThrough.getTime() - initialHistoryMs,
        ),
      },
      synchronizedThrough,
    };
  }

  private async advanceCursor(
    repositoryId: string,
    kind: 'ISSUE' | 'PULL_REQUEST',
    synchronizedThrough: Date,
  ): Promise<void> {
    await this.prisma.workItemSyncCursor.upsert({
      where: { repositoryId_kind: { kind, repositoryId } },
      create: { kind, repositoryId, synchronizedThrough },
      update: { synchronizedThrough },
    });
  }

  private async persistIssue(
    repository: SyncRepository,
    issue: ProviderIssue,
    baseline: boolean,
    previousSynchronizedThrough: Date | null,
  ): Promise<void> {
    const previous = await this.prisma.issue.findUnique({
      select: { state: true },
      where: { repositoryId_providerIssueId: { providerIssueId: issue.providerIssueId, repositoryId: repository.id } },
    });
    const record = await this.prisma.transaction(async (transaction) => {
      const authorId = issue.author
        ? await this.upsertActor(repository.providerAccountId, issue.author, transaction)
        : null;
      const record = await transaction.issue.upsert({
        where: {
          repositoryId_providerIssueId: { providerIssueId: issue.providerIssueId, repositoryId: repository.id },
        },
        create: { ...this.issueData(issue), authorId, repositoryId: repository.id },
        update: { ...this.issueData(issue), authorId },
      });
      const actorIds = await Promise.all(
        issue.assignees.map((actor) => this.upsertActor(repository.providerAccountId, actor, transaction)),
      );
      const labelIds = await Promise.all(
        issue.labels.map((label) => this.upsertLabel(repository.id, label, transaction)),
      );
      await transaction.issueAssignee.deleteMany({ where: { issueId: record.id } });
      await transaction.issueLabel.deleteMany({ where: { issueId: record.id } });
      if (actorIds.length > 0)
        await transaction.issueAssignee.createMany({
          data: actorIds.map((actorId) => ({ actorId, issueId: record.id })),
        });
      if (labelIds.length > 0)
        await transaction.issueLabel.createMany({ data: labelIds.map((labelId) => ({ issueId: record.id, labelId })) });
      return record;
    });
    if (baseline) return;
    const events = issueLifecycleEvents(
      previous?.state ?? null,
      record.state,
      Boolean(previousSynchronizedThrough && issue.providerCreatedAt > previousSynchronizedThrough),
    );
    for (const eventType of events) await this.notifications.emitIssueEvent(eventType, record);
  }

  private issueData(issue: ProviderIssue) {
    return {
      body: issue.body,
      closedAt: issue.closedAt,
      milestone: issue.milestone,
      number: issue.number,
      providerCreatedAt: issue.providerCreatedAt,
      providerIssueId: issue.providerIssueId,
      providerUpdatedAt: issue.providerUpdatedAt,
      state: issue.state,
      title: issue.title,
      url: issue.url,
    };
  }

  private async persistPullRequest(
    repository: SyncRepository,
    pullRequest: ProviderPullRequest,
    baseline: boolean,
    previousSynchronizedThrough: Date | null,
  ): Promise<void> {
    const previous = await this.prisma.pullRequest.findUnique({
      select: { state: true },
      where: {
        repositoryId_providerPullRequestId: {
          providerPullRequestId: pullRequest.providerPullRequestId,
          repositoryId: repository.id,
        },
      },
    });
    const record = await this.prisma.transaction(async (transaction) => {
      const authorId = pullRequest.author
        ? await this.upsertActor(repository.providerAccountId, pullRequest.author, transaction)
        : null;
      const persisted = await transaction.pullRequest.upsert({
        where: {
          repositoryId_providerPullRequestId: {
            providerPullRequestId: pullRequest.providerPullRequestId,
            repositoryId: repository.id,
          },
        },
        create: { ...this.pullRequestData(pullRequest), authorId, repositoryId: repository.id },
        update: { ...this.pullRequestData(pullRequest), authorId },
      });
      const actorIds = await Promise.all(
        pullRequest.assignees.map((actor) => this.upsertActor(repository.providerAccountId, actor, transaction)),
      );
      const labelIds = await Promise.all(
        pullRequest.labels.map((label) => this.upsertLabel(repository.id, label, transaction)),
      );
      await transaction.pullRequestAssignee.deleteMany({ where: { pullRequestId: persisted.id } });
      await transaction.pullRequestLabel.deleteMany({ where: { pullRequestId: persisted.id } });
      if (actorIds.length > 0)
        await transaction.pullRequestAssignee.createMany({
          data: actorIds.map((actorId) => ({ actorId, pullRequestId: persisted.id })),
        });
      if (labelIds.length > 0)
        await transaction.pullRequestLabel.createMany({
          data: labelIds.map((labelId) => ({ labelId, pullRequestId: persisted.id })),
        });
      await transaction.workflowRun.updateMany({
        data: { pullRequestId: persisted.id },
        where: { changeRequestNumber: persisted.number, repositoryId: repository.id },
      });
      return persisted;
    });
    await this.refreshPullRequestWorkflowStatus(record.id);
    if (baseline) return;
    const events = pullRequestLifecycleEvents(
      previous?.state ?? null,
      record.state,
      Boolean(previousSynchronizedThrough && pullRequest.providerCreatedAt > previousSynchronizedThrough),
    );
    for (const eventType of events) await this.notifications.emitPullRequestEvent(eventType, record);
  }

  private pullRequestData(pullRequest: ProviderPullRequest) {
    return {
      body: pullRequest.body,
      closedAt: pullRequest.closedAt,
      draft: pullRequest.draft,
      mergedAt: pullRequest.mergedAt,
      number: pullRequest.number,
      providerCreatedAt: pullRequest.providerCreatedAt,
      providerPullRequestId: pullRequest.providerPullRequestId,
      providerUpdatedAt: pullRequest.providerUpdatedAt,
      sourceBranch: pullRequest.sourceBranch,
      state: pullRequest.state,
      targetBranch: pullRequest.targetBranch,
      title: pullRequest.title,
      url: pullRequest.url,
    };
  }

  /** Recalculate the persisted workflow aggregate for one pull request. */
  async refreshPullRequestWorkflowStatus(pullRequestId: string): Promise<void> {
    const runs = await this.prisma.workflowRun.findMany({
      distinct: ['workflowId', 'scopeKey'],
      orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
      select: { awaitingApproval: true, status: true },
      where: { pullRequestId },
    });
    await this.prisma.pullRequest.update({
      data: {
        workflowApprovalRequired: runs.some((run) => run.awaitingApproval),
        workflowStatus: this.aggregateWorkflowStatus(runs.map((run) => run.status)),
      },
      where: { id: pullRequestId },
    });
  }

  private aggregateWorkflowStatus(statuses: string[]): PullRequestWorkflowStatus {
    if (statuses.includes('FAILED')) return 'FAILED';
    if (statuses.includes('RUNNING')) return 'RUNNING';
    if (statuses.includes('QUEUED')) return 'PENDING';
    if (statuses.includes('CANCELLED')) return 'CANCELLED';
    if (statuses.includes('SUCCESS') || statuses.includes('SKIPPED')) return 'SUCCESS';
    return 'UNKNOWN';
  }

  private async upsertActor(
    providerAccountId: string,
    actor: ProviderActor,
    transaction: Parameters<Parameters<PrismaService['transaction']>[0]>[0],
  ): Promise<string> {
    const persisted = await transaction.providerActor.upsert({
      where: { providerAccountId_providerActorId: { providerAccountId, providerActorId: actor.providerActorId } },
      create: { ...actor, providerAccountId },
      update: actor,
    });
    return persisted.id;
  }

  private async upsertLabel(
    repositoryId: string,
    label: ProviderWorkItemLabel,
    transaction: Parameters<Parameters<PrismaService['transaction']>[0]>[0],
  ): Promise<string> {
    const normalizedName = label.name.trim().toLocaleLowerCase('en-US');
    const persisted = await transaction.workItemLabel.upsert({
      where: { repositoryId_normalizedName: { normalizedName, repositoryId } },
      create: { ...label, normalizedName, repositoryId },
      update: { ...label, normalizedName },
    });
    return persisted.id;
  }
}
