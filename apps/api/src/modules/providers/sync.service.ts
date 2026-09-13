import { Injectable, Logger, Optional } from '@nestjs/common';

import type { ProviderType } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { WorkflowFilterService } from '../repositories/workflow-filter.service.js';
import { SystemStatusService } from '../system-status/system-status.service.js';
import type {
  ProviderAccountContext,
  ProviderAdapter,
  ProviderRepositoryReference,
  ProviderSyncScope,
  ProviderWorkflowRun,
} from './provider-adapter.js';
import { ProviderAdapterRegistry } from './provider-adapter.registry.js';
import { ProviderCredentialService } from './provider-credential.service.js';
import { RepositoryMetadataService } from './repository-metadata.service.js';
import type { RepositorySyncProgressReporter } from './sync-progress.js';
import { WorkItemSyncService } from './work-item-sync.service.js';

const terminalWorkflowRunStatuses = ['SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED', 'UNKNOWN'] as const;
const closedChangeRequestRefreshIntervalMs = 24 * 60 * 60 * 1000;
const unknownChangeRequestRefreshIntervalMs = 60 * 60 * 1000;

/** Incrementally synchronizes enabled tracked repositories without provider writes. */
@Injectable()
export class ProviderSyncService {
  private readonly logger = new Logger(ProviderSyncService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: ProviderAdapterRegistry,
    private readonly credentials: ProviderCredentialService,
    private readonly metadata: RepositoryMetadataService,
    private readonly filters: WorkflowFilterService,
    private readonly notifications: NotificationsService,
    private readonly status: SystemStatusService,
    @Optional() private readonly workItems?: WorkItemSyncService,
  ) {}

  async syncEnabledRepositories(): Promise<void> {
    const syncId = this.status.beginProviderSync();
    try {
      const repositories = await this.prisma.repository.findMany({
        where: { enabled: true, providerAccount: { enabled: true } },
        include: { providerAccount: true, workflowFilters: true },
      });
      for (const [index, repository] of repositories.entries()) {
        await this.syncRepository(repository, {
          id: syncId,
          repositoriesCompleted: index,
          repositoriesTotal: repositories.length,
        });
        this.status.updateProviderSync(syncId, {
          phase: 'FETCHING_WORKFLOWS',
          repositoriesCompleted: index + 1,
          repositoriesTotal: repositories.length,
          workflowRunsCompleted: null,
          workflowRunsTotal: null,
        });
      }
    } finally {
      this.status.finishProviderSync(syncId);
    }
  }

  /** Synchronize one enabled repository claimed by the durable sync queue. */
  async syncRepositoryById(
    repositoryId: string,
    scopes: ProviderSyncScope[] = ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS'],
    reportProgress?: RepositorySyncProgressReporter,
  ): Promise<boolean> {
    const syncId = this.status.beginProviderSync();
    try {
      const repository = await this.prisma.repository.findFirst({
        where: { enabled: true, id: repositoryId, providerAccount: { enabled: true } },
        include: { providerAccount: true, workflowFilters: true },
      });
      if (!repository) return false;

      await this.syncRepository(
        repository,
        { id: syncId, repositoriesCompleted: 0, repositoriesTotal: 1 },
        scopes,
        reportProgress,
      );
      this.status.updateProviderSync(syncId, {
        phase: 'FETCHING_WORKFLOWS',
        repositoriesCompleted: 1,
        repositoriesTotal: 1,
        workflowRunsCompleted: null,
        workflowRunsTotal: null,
      });
      return true;
    } finally {
      this.status.finishProviderSync(syncId);
    }
  }

  private async syncRepository(
    repository: Awaited<ReturnType<PrismaService['repository']['findMany']>>[number] & {
      providerAccount: { id: string; providerType: ProviderType; baseUrl: string | null; encryptedAccessToken: string };
      workflowFilters: { mode: 'ALLOW' | 'DENY'; pattern: string }[];
    },
    progress: { id: string; repositoriesCompleted: number; repositoriesTotal: number },
    scopes: ProviderSyncScope[] = ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS'],
    reportProgress?: RepositorySyncProgressReporter,
  ): Promise<void> {
    const synchronizationStartedAt = new Date();
    this.status.updateProviderSync(progress.id, {
      phase: 'FETCHING_WORKFLOWS',
      repositoriesCompleted: progress.repositoriesCompleted,
      repositoriesTotal: progress.repositoriesTotal,
      workflowRunsCompleted: null,
      workflowRunsTotal: null,
    });
    try {
      await reportProgress?.({ current: null, phase: 'LOADING_REPOSITORY', total: null });
      const refreshedRepository = await this.metadata.refresh(repository);
      const adapter = this.adapters.get(refreshedRepository.providerAccount.providerType);
      const context = {
        providerAccountId: refreshedRepository.providerAccount.id,
        baseUrl: refreshedRepository.providerAccount.baseUrl,
        accessToken: this.credentials.decrypt(refreshedRepository.providerAccount.encryptedAccessToken),
      };
      await this.workItems?.synchronize(context, refreshedRepository, adapter, scopes, reportProgress);
      if (!scopes.includes('WORKFLOWS')) {
        await this.markSynchronizationSuccess(repository, synchronizationStartedAt, false);
        return;
      }
      await reportProgress?.({ current: null, phase: 'FETCHING_WORKFLOWS', total: null });
      const discoveredRuns = await adapter.listWorkflowRuns(
        context,
        refreshedRepository,
        refreshedRepository.lastSyncAt ?? undefined,
      );
      const currentRuns = await this.prisma.workflowRun.findMany({
        distinct: ['workflowId', 'scopeKey'],
        orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
        select: { awaitingApproval: true, providerRunId: true, status: true },
        where: {
          repositoryId: repository.id,
        },
      });
      const runsToRefresh = currentRuns.filter(
        (run) => run.awaitingApproval || run.status === 'FAILED' || run.status === 'QUEUED' || run.status === 'RUNNING',
      );
      const refreshedRuns: (ProviderWorkflowRun | null)[] = [];
      for (const { providerRunId } of runsToRefresh)
        refreshedRuns.push(await adapter.getWorkflowRun(context, refreshedRepository, providerRunId));
      const runsByProviderId = new Map(discoveredRuns.map((run) => [run.providerRunId, run]));
      for (const run of refreshedRuns) if (run) runsByProviderId.set(run.providerRunId, run);
      const runs = [...runsByProviderId.values()];
      await reportProgress?.({ current: 0, phase: 'PROCESSING_WORKFLOWS', total: runs.length });
      this.status.updateProviderSync(progress.id, {
        phase: 'PROCESSING_WORKFLOWS',
        repositoriesCompleted: progress.repositoriesCompleted,
        repositoriesTotal: progress.repositoriesTotal,
        workflowRunsCompleted: 0,
        workflowRunsTotal: runs.length,
      });
      for (const [index, run] of runs.entries()) {
        if (this.filters.shouldTrack(run.workflowName, repository.workflowFilters))
          await this.persistRunAndEvaluateRules(repository.id, run);
        await reportProgress?.({ current: index + 1, phase: 'PROCESSING_WORKFLOWS', total: runs.length });
        this.status.updateProviderSync(progress.id, {
          phase: 'PROCESSING_WORKFLOWS',
          repositoriesCompleted: progress.repositoriesCompleted,
          repositoriesTotal: progress.repositoriesTotal,
          workflowRunsCompleted: index + 1,
          workflowRunsTotal: runs.length,
        });
      }
      await reportProgress?.({ current: null, phase: 'REFRESHING_CHANGE_REQUESTS', total: null });
      await this.refreshChangeRequestStates(context, refreshedRepository, adapter);
      await this.markSynchronizationSuccess(repository, synchronizationStartedAt);
    } catch (error) {
      await this.prisma.providerAccount.update({
        where: { id: repository.providerAccount.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncError: 'Synchronization failed. Check provider connectivity and credentials.',
        },
      });
      this.logger.warn(`Synchronization failed for provider account ${repository.providerAccount.id}.`);
      throw error;
    } finally {
      await this.status.refreshRunningWorkflowCount();
    }
  }

  private async markSynchronizationSuccess(
    repository: { id: string; providerAccount: { id: string } },
    lastSyncAt: Date,
    updateWorkflowCursor = true,
  ): Promise<void> {
    if (updateWorkflowCursor)
      await this.prisma.repository.update({ where: { id: repository.id }, data: { lastSyncAt } });
    await this.prisma.providerAccount.update({
      where: { id: repository.providerAccount.id },
      data: { lastSyncAt, lastSyncError: null },
    });
  }

  /** Refresh lifecycle metadata for change requests whose current terminal workflow result still failed. */
  private async refreshChangeRequestStates(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference & { id: string },
    adapter: ProviderAdapter,
  ): Promise<void> {
    const latestTerminalRuns = await this.prisma.workflowRun.findMany({
      distinct: ['workflowId', 'scopeKey'],
      orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
      select: {
        changeRequestCheckedAt: true,
        changeRequestNumber: true,
        changeRequestState: true,
        status: true,
      },
      where: {
        awaitingApproval: false,
        changeRequestNumber: { not: null },
        completedAt: { not: null },
        repositoryId: repository.id,
        status: { in: [...terminalWorkflowRunStatuses] },
        workflow: { kind: 'STANDARD' },
      },
    });
    const now = new Date();
    const candidates = new Map<string, (typeof latestTerminalRuns)[number]>();
    for (const run of latestTerminalRuns) {
      if (run.status !== 'FAILED' || !run.changeRequestNumber) continue;
      const existing = candidates.get(run.changeRequestNumber);
      if (!existing || (!this.shouldRefreshChangeRequest(existing, now) && this.shouldRefreshChangeRequest(run, now)))
        candidates.set(run.changeRequestNumber, run);
    }

    for (const [changeRequestNumber, candidate] of candidates) {
      if (!this.shouldRefreshChangeRequest(candidate, now)) continue;
      const state = await adapter.getChangeRequestState(context, repository, changeRequestNumber);
      await this.prisma.workflowRun.updateMany({
        data: {
          changeRequestCheckedAt: now,
          changeRequestMergedAt: state?.mergedAt ?? null,
          changeRequestState: state?.state ?? 'UNKNOWN',
          changeRequestTargetBranch: state?.targetBranch ?? null,
        },
        where: { changeRequestNumber, repositoryId: repository.id },
      });
    }
  }

  /** Decide whether cached change-request lifecycle metadata is old enough to refresh. */
  private shouldRefreshChangeRequest(
    candidate: { changeRequestCheckedAt: Date | null; changeRequestState: 'UNKNOWN' | 'OPEN' | 'CLOSED' | 'MERGED' },
    now: Date,
  ): boolean {
    if (candidate.changeRequestState === 'MERGED') return false;
    if (candidate.changeRequestState === 'OPEN' || !candidate.changeRequestCheckedAt) return true;
    const refreshInterval =
      candidate.changeRequestState === 'CLOSED'
        ? closedChangeRequestRefreshIntervalMs
        : unknownChangeRequestRefreshIntervalMs;
    return now.getTime() - candidate.changeRequestCheckedAt.getTime() >= refreshInterval;
  }

  private async persistRunAndEvaluateRules(repositoryId: string, run: ProviderWorkflowRun): Promise<void> {
    const { providerWorkflowId, workflowKind, workflowPath, ...runData } = run;
    const lastSeenAt = new Date();
    const workflow = await this.prisma.workflow.upsert({
      where: { repositoryId_providerWorkflowId: { repositoryId, providerWorkflowId } },
      create: {
        kind: workflowKind,
        lastSeenAt,
        name: run.workflowName,
        path: workflowPath,
        providerWorkflowId,
        repositoryId,
      },
      update: {
        kind: workflowKind,
        lastSeenAt,
        name: run.workflowName,
        path: workflowPath,
      },
    });
    await this.consolidateLegacyWorkflow(repositoryId, run, workflow.id);
    const pullRequest =
      run.changeRequestNumber && this.workItems
        ? await this.prisma.pullRequest.findUnique({
            select: { id: true },
            where: { repositoryId_number: { number: run.changeRequestNumber, repositoryId } },
          })
        : null;
    const workflowRun = await this.prisma.workflowRun.upsert({
      where: { repositoryId_providerRunId: { repositoryId, providerRunId: run.providerRunId } },
      create: {
        ...runData,
        ...(this.workItems ? { pullRequestId: pullRequest?.id ?? null } : {}),
        repositoryId,
        workflowId: workflow.id,
      },
      update: {
        ...runData,
        ...(this.workItems ? { pullRequestId: pullRequest?.id ?? null } : {}),
        workflowId: workflow.id,
      },
    });
    await this.notifications.evaluateRulesForRun(workflowRun);
    if (workflowRun.pullRequestId) await this.workItems?.refreshPullRequestWorkflowStatus(workflowRun.pullRequestId);
  }

  private async consolidateLegacyWorkflow(
    repositoryId: string,
    run: ProviderWorkflowRun,
    workflowId: string,
  ): Promise<void> {
    const legacyProviderWorkflowId =
      run.workflowKind === 'DEPENDABOT_INTERNAL'
        ? 'github:dynamic/dependabot/dependabot-updates'
        : `legacy:name:${run.workflowName}`;
    if (legacyProviderWorkflowId === run.providerWorkflowId) return;

    const legacyWorkflow = await this.prisma.workflow.findUnique({
      where: {
        repositoryId_providerWorkflowId: { providerWorkflowId: legacyProviderWorkflowId, repositoryId },
      },
    });
    if (!legacyWorkflow || legacyWorkflow.id === workflowId) return;

    await this.prisma.workflowRun.updateMany({
      data: { scopeKey: run.scopeKey, workflowId },
      where: { workflowId: legacyWorkflow.id },
    });
    await this.prisma.workflow.delete({ where: { id: legacyWorkflow.id } });
  }
}
