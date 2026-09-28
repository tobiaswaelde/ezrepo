import { Injectable } from '@nestjs/common';

import {
  NotificationEventType,
  type Issue,
  type PullRequest,
  type PullRequestWorkflowStatus,
  type WorkflowRun,
} from '../../generated/prisma/client.js';
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

type WorkItemTransaction = Parameters<Parameters<PrismaService['transaction']>[0]>[0];
type ReconciledRun = Pick<WorkflowRun, 'id' | 'headBranch' | 'providerCreatedAt'>;
type ReconciledPullRequest = Pick<
  PullRequest,
  'id' | 'closedAt' | 'mergedAt' | 'number' | 'providerCreatedAt' | 'sourceBranch' | 'state' | 'targetBranch'
>;

type SyncRepository = ProviderRepositoryReference & { id: string; providerAccountId: string };

/**
 * Classify persisted issue state changes into global notification events.
 *
 * @param previousState - Previously persisted lifecycle state, or null for a newly discovered item.
 * @param state - Current normalized lifecycle state.
 * @param createdAfterCursor - Whether the item was created after the preceding synchronization boundary.
 * @returns Issue lifecycle events implied by the persisted state transition.
 */
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

/**
 * Classify persisted pull-request state changes into global notification events.
 *
 * @param previousState - Previously persisted lifecycle state, or null for a newly discovered item.
 * @param state - Current normalized lifecycle state.
 * @param createdAfterCursor - Whether the item was created after the preceding synchronization boundary.
 * @returns Pull-request lifecycle events implied by the persisted state transition.
 */
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
  /**
   * Initialize WorkItemSyncService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   * @param notifications - Service managing channels and idempotent notification events.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Synchronize issue and pull-request domains with independent durable cursors.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @param repository - Repository identity and metadata required by the operation.
   * @param adapter - Read-only provider adapter for the selected repository.
   * @param scopes - Repository domains requested for this synchronization.
   * @param reportProgress - Optional asynchronous callback persisting per-repository progress.
   * @returns A promise that resolves when the operation completes.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   * @throws Error - When an event delivery lacks its repository, event type, or source work item.
   */
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

  /**
   * Associate legacy branch-scoped workflow runs with the pull request active when each run was created.
   *
   * @param repositoryId - Local identifier of the tracked repository.
   * @returns A promise that resolves when the operation completes.
   */
  async reconcileWorkflowRunChangeRequests(repositoryId: string): Promise<void> {
    const runs = await this.prisma.workflowRun.findMany({
      orderBy: [{ providerCreatedAt: 'asc' }, { id: 'asc' }],
      select: { headBranch: true, id: true, providerCreatedAt: true },
      where: {
        changeRequestNumber: null,
        headBranch: { not: null },
        repositoryId,
        workflow: { kind: 'STANDARD' },
      },
    });
    const branches = [...new Set(runs.flatMap((run) => (run.headBranch ? [run.headBranch] : [])))];
    if (branches.length === 0) return;

    const pullRequests = await this.prisma.pullRequest.findMany({
      orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
      select: {
        closedAt: true,
        id: true,
        mergedAt: true,
        number: true,
        providerCreatedAt: true,
        sourceBranch: true,
        state: true,
        targetBranch: true,
      },
      where: { repositoryId, sourceBranch: { in: branches } },
    });
    const runIdsByPullRequest = this.groupRunsByPullRequest(runs, pullRequests);

    const checkedAt = new Date();
    for (const pullRequest of pullRequests) {
      const runIds = runIdsByPullRequest.get(pullRequest.id);
      if (!runIds) continue;
      await this.prisma.workflowRun.updateMany({
        data: {
          changeRequestCheckedAt: checkedAt,
          changeRequestMergedAt: pullRequest.mergedAt,
          changeRequestNumber: pullRequest.number,
          changeRequestState: pullRequest.state,
          changeRequestTargetBranch: pullRequest.targetBranch,
          pullRequestId: pullRequest.id,
          scopeKey: `change-request:${pullRequest.number}`,
        },
        where: { id: { in: runIds } },
      });
      await this.refreshPullRequestWorkflowStatus(pullRequest.id);
    }
  }

  /**
   * Associate branch-scoped runs with the first matching pull request active at run creation.
   *
   * @param runs - Workflow runs to aggregate, associate, or persist.
   * @param pullRequests - Candidate pull requests ordered newest first for branch and lifetime matching.
   * @returns Workflow-run IDs grouped by the local ID of their matching pull request.
   */
  private groupRunsByPullRequest(runs: ReconciledRun[], pullRequests: ReconciledPullRequest[]): Map<string, string[]> {
    const runIdsByPullRequest = new Map<string, string[]>();
    for (const run of runs) {
      // ponytail: retained history bounds this scan; replace it with a database range join if sync volume becomes costly.
      const pullRequest = pullRequests.find((candidate) => {
        const terminalAt = candidate.mergedAt ?? candidate.closedAt;
        return (
          candidate.sourceBranch === run.headBranch &&
          candidate.providerCreatedAt <= run.providerCreatedAt &&
          (!terminalAt || run.providerCreatedAt <= terminalAt)
        );
      });
      if (!pullRequest) continue;
      const runIds = runIdsByPullRequest.get(pullRequest.id);
      if (runIds) runIds.push(run.id);
      else runIdsByPullRequest.set(pullRequest.id, [run.id]);
    }

    return runIdsByPullRequest;
  }

  /**
   * Fetch and persist issues before advancing their independent synchronization cursor.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @param repository - Repository identity and metadata required by the operation.
   * @param adapter - Read-only provider adapter for the selected repository.
   * @param reportProgress - Optional asynchronous callback persisting per-repository progress.
   * @returns A promise that resolves when the operation completes.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   * @throws Error - When an event delivery lacks its repository, event type, or source work item.
   */
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

  /**
   * Fetch and persist pull requests before advancing their independent synchronization cursor.
   *
   * @param context - Provider account credentials and instance configuration for this request.
   * @param repository - Repository identity and metadata required by the operation.
   * @param adapter - Read-only provider adapter for the selected repository.
   * @param reportProgress - Optional asynchronous callback persisting per-repository progress.
   * @returns A promise that resolves when the operation completes.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   * @throws Error - When an event delivery lacks its repository, event type, or source work item.
   */
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

  /**
   * Resolve the initial history window or overlapping incremental window for one work-item domain.
   *
   * @param repositoryId - Local identifier of the tracked repository.
   * @param kind - Work-item domain whose independent cursor is being accessed.
   * @returns Baseline status, the previous cursor, provider query window, and prospective next cursor.
   */
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

  /**
   * Persist the completed synchronization boundary for one repository work-item domain.
   *
   * @param repositoryId - Local identifier of the tracked repository.
   * @param kind - Work-item domain whose independent cursor is being accessed.
   * @param synchronizedThrough - Successfully processed time boundary to persist as the next cursor.
   * @returns A promise that resolves when the operation completes.
   */
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

  /**
   * Persist an issue transaction and emit lifecycle events only after the baseline synchronization.
   *
   * @param repository - Repository identity and metadata required by the operation.
   * @param issue - Issue data being normalized, persisted, or used as an event source.
   * @param baseline - Whether this is the initial synchronization, during which lifecycle notifications are suppressed.
   * @param previousSynchronizedThrough - Previous cursor used to distinguish newly created items from historical
   * discoveries.
   * @returns A promise that resolves when the operation completes.
   * @throws Error - When an event delivery lacks its repository, event type, or source work item.
   */
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
    const record = await this.prisma.transaction((transaction) => this.upsertIssue(repository, issue, transaction));
    if (baseline) return;
    const events = issueLifecycleEvents(
      previous?.state ?? null,
      record.state,
      Boolean(previousSynchronizedThrough && issue.providerCreatedAt > previousSynchronizedThrough),
    );
    for (const eventType of events) await this.notifications.emitIssueEvent(eventType, record);
  }

  /**
   * Upsert an issue and replace its assignee and label relations inside the supplied transaction.
   *
   * @param repository - Repository identity and metadata required by the operation.
   * @param issue - Issue data being normalized, persisted, or used as an event source.
   * @param transaction - Existing transaction in which all related records must be updated atomically.
   * @returns The persisted issue after its relations have been replaced.
   */
  private async upsertIssue(
    repository: SyncRepository,
    issue: ProviderIssue,
    transaction: WorkItemTransaction,
  ): Promise<Issue> {
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
  }

  /**
   * Project provider issue fields into the persisted scalar record.
   *
   * @param issue - Issue data being normalized, persisted, or used as an event source.
   * @returns Scalar issue fields for both creation and update.
   */
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

  /**
   * Persist a pull request, refresh workflow status, and emit post-baseline lifecycle events.
   *
   * @param repository - Repository identity and metadata required by the operation.
   * @param pullRequest - Pull-request data being normalized, persisted, or used as an event source.
   * @param baseline - Whether this is the initial synchronization, during which lifecycle notifications are suppressed.
   * @param previousSynchronizedThrough - Previous cursor used to distinguish newly created items from historical
   * discoveries.
   * @returns A promise that resolves when the operation completes.
   * @throws Error - When an event delivery lacks its repository, event type, or source work item.
   */
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
    const record = await this.prisma.transaction((transaction) =>
      this.upsertPullRequest(repository, pullRequest, transaction),
    );
    await this.refreshPullRequestWorkflowStatus(record.id);
    if (baseline) return;
    const events = pullRequestLifecycleEvents(
      previous?.state ?? null,
      record.state,
      Boolean(previousSynchronizedThrough && pullRequest.providerCreatedAt > previousSynchronizedThrough),
    );
    for (const eventType of events) await this.notifications.emitPullRequestEvent(eventType, record);
  }

  /**
   * Upsert a pull request, replace its relations, and attach matching runs inside one transaction.
   *
   * @param repository - Repository identity and metadata required by the operation.
   * @param pullRequest - Pull-request data being normalized, persisted, or used as an event source.
   * @param transaction - Existing transaction in which all related records must be updated atomically.
   * @returns The persisted pull request after relations and matching workflow runs have been updated.
   */
  private async upsertPullRequest(
    repository: SyncRepository,
    pullRequest: ProviderPullRequest,
    transaction: WorkItemTransaction,
  ): Promise<PullRequest> {
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
  }

  /**
   * Project provider pull-request fields into the persisted scalar record.
   *
   * @param pullRequest - Pull-request data being normalized, persisted, or used as an event source.
   * @returns Scalar pull-request fields for both creation and update.
   */
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

  /**
   * Recalculate the persisted workflow aggregate for one pull request.
   *
   * @param pullRequestId - Local identifier of the pull request whose aggregate is refreshed.
   * @returns A promise that resolves when the operation completes.
   */
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

  /**
   * Choose the pull-request workflow state using failure, active, pending, and success precedence.
   *
   * @param statuses - Current workflow outcomes to combine using the established precedence.
   * @returns The aggregate status using the established precedence.
   */
  private aggregateWorkflowStatus(statuses: string[]): PullRequestWorkflowStatus {
    if (statuses.includes('FAILED')) return 'FAILED';
    if (statuses.includes('RUNNING')) return 'RUNNING';
    if (statuses.includes('QUEUED')) return 'PENDING';
    if (statuses.includes('CANCELLED')) return 'CANCELLED';
    if (statuses.includes('SUCCESS') || statuses.includes('SKIPPED')) return 'SUCCESS';
    return 'UNKNOWN';
  }

  /**
   * Upsert an actor within its provider account and return the local identity.
   *
   * @param providerAccountId - Local identifier of the provider account.
   * @param actor - Optional provider user identity associated with a work item.
   * @param transaction - Existing transaction in which all related records must be updated atomically.
   * @returns The local identifier of the persisted actor.
   */
  private async upsertActor(
    providerAccountId: string,
    actor: ProviderActor,
    transaction: WorkItemTransaction,
  ): Promise<string> {
    const persisted = await transaction.providerActor.upsert({
      where: { providerAccountId_providerActorId: { providerAccountId, providerActorId: actor.providerActorId } },
      create: { ...actor, providerAccountId },
      update: actor,
    });
    return persisted.id;
  }

  /**
   * Upsert a repository label using its trimmed, case-normalized name.
   *
   * @param repositoryId - Local identifier of the tracked repository.
   * @param label - Provider label whose name and color are persisted for the repository.
   * @param transaction - Existing transaction in which all related records must be updated atomically.
   * @returns The local identifier of the persisted repository label.
   */
  private async upsertLabel(
    repositoryId: string,
    label: ProviderWorkItemLabel,
    transaction: WorkItemTransaction,
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
