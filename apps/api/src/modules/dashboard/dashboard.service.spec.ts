import { BadRequestException } from '@nestjs/common';

import { CaslAbilityFactory } from '../../casl/casl-ability.factory.js';
import type { WorkflowRun } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { WorkflowRunsQueryService } from '../workflow-runs/workflow-runs-query.service.js';
import { DashboardService } from './dashboard.service.js';

function prisma(retainedRunDurationMs = 0n, currentRunDurationMs = 0): PrismaService {
  return {
    repository: { aggregate: jest.fn().mockResolvedValue({ _sum: { retainedRunDurationMs } }) },
    workflowRun: { aggregate: jest.fn().mockResolvedValue({ _sum: { durationMs: currentRunDurationMs } }) },
  } as unknown as PrismaService;
}

describe('DashboardService', () => {
  it('limits the needs-attention dashboard preview to 15 newest visible runs', async () => {
    const ability = {};
    const failures = Array.from({ length: 15 }, (_, index) =>
      run({
        completedAt: `2026-08-26T${String(23 - index).padStart(2, '0')}:00:00.000Z`,
        repositoryId: 'repository-a',
        status: 'FAILED',
        workflowName: `Workflow ${index}`,
      }),
    );
    const workflowRuns = {
      findNeedsAttention: jest.fn().mockResolvedValue(failures),
      getReadAbility: jest.fn().mockResolvedValue(ability),
    } as unknown as WorkflowRunsQueryService;
    const service = new DashboardService(workflowRuns, prisma());

    await expect(service.getLatestFailures({ id: 'viewer', role: 'VIEWER', username: 'viewer' })).resolves.toEqual(
      failures,
    );
    expect(workflowRuns.findNeedsAttention).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
        take: 15,
      }),
      ability,
    );
  });

  it('limits the latest-run dashboard result to ten visible runs', async () => {
    const ability = {};
    const workflowRuns = {
      findMany: jest.fn().mockResolvedValue([
        run({
          completedAt: '2026-08-26T11:00:00.000Z',
          repositoryId: 'repository-a',
          status: 'RUNNING',
          workflowName: 'Test',
        }),
      ]),
      getReadAbility: jest.fn().mockResolvedValue(ability),
    } as unknown as WorkflowRunsQueryService;
    const service = new DashboardService(workflowRuns, prisma());

    await expect(service.getLatestRuns({ id: 'viewer', role: 'VIEWER', username: 'viewer' })).resolves.toHaveLength(1);
    expect(workflowRuns.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
        take: 10,
      }),
      ability,
    );
  });

  it('returns visible approval-gated runs ordered by provider creation time', async () => {
    const ability = {};
    const workflowRuns = {
      findCurrent: jest.fn().mockResolvedValue([
        run({
          completedAt: null,
          providerCreatedAt: '2026-08-26T11:00:00.000Z',
          repositoryId: 'repository-a',
          status: 'QUEUED',
          workflowName: 'Deploy',
        }),
      ]),
      getReadAbility: jest.fn().mockResolvedValue(ability),
    } as unknown as WorkflowRunsQueryService;

    await expect(
      new DashboardService(workflowRuns, prisma()).getAwaitingApproval({
        id: 'viewer',
        role: 'VIEWER',
        username: 'viewer',
      }),
    ).resolves.toHaveLength(1);
    expect(workflowRuns.findCurrent).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.anything(),
        orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
        where: { awaitingApproval: true },
      }),
      ability,
    );
  });

  it('aggregates visible completed runs into continuous UTC trend buckets', async () => {
    const ability = {};
    const workflowRuns = {
      findMany: jest.fn().mockResolvedValue([
        run({
          completedAt: '2026-08-25T23:30:00.000Z',
          repositoryId: 'repository-a',
          status: 'SUCCESS',
          workflowName: 'Build',
        }),
        run({
          completedAt: '2026-08-26T12:00:00.000Z',
          repositoryId: 'repository-a',
          status: 'FAILED',
          workflowName: 'Test',
        }),
      ]),
      getReadAbility: jest.fn().mockResolvedValue(ability),
    } as unknown as WorkflowRunsQueryService;
    const service = new DashboardService(workflowRuns, prisma());

    await expect(
      service.getTrend(
        { id: 'viewer', role: 'VIEWER', username: 'viewer' },
        { bucket: 'day', from: '2026-08-25T10:00:00.000Z', to: '2026-08-27T01:00:00.000Z' },
      ),
    ).resolves.toEqual([
      { bucketStart: new Date('2026-08-25T00:00:00.000Z'), errorCount: 0, successCount: 1 },
      { bucketStart: new Date('2026-08-26T00:00:00.000Z'), errorCount: 1, successCount: 0 },
      { bucketStart: new Date('2026-08-27T00:00:00.000Z'), errorCount: 0, successCount: 0 },
    ]);
    expect(workflowRuns.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          completedAt: {
            gte: '2026-08-25T10:00:00.000Z',
            lte: '2026-08-27T01:00:00.000Z',
          },
          status: { in: ['SUCCESS', 'FAILED'] },
        },
      }),
      ability,
    );
  });

  it('summarizes visible completed and active workflow runs', async () => {
    const ability = new CaslAbilityFactory().createForUser({ id: 'viewer', role: 'VIEWER', username: 'viewer' }, []);
    const workflowRuns = {
      findCurrent: jest.fn().mockResolvedValue([
        { awaitingApproval: true, durationMs: null, status: 'QUEUED' },
        { awaitingApproval: false, durationMs: null, status: 'RUNNING' },
      ]),
      findMany: jest.fn().mockResolvedValue([
        { awaitingApproval: false, durationMs: 100_000, status: 'SUCCESS' },
        { awaitingApproval: false, durationMs: 300_000, status: 'FAILED' },
        { awaitingApproval: false, durationMs: null, status: 'SKIPPED' },
      ]),
      getReadAbility: jest.fn().mockResolvedValue(ability),
    } as unknown as WorkflowRunsQueryService;

    await expect(
      new DashboardService(workflowRuns, prisma(600_000n, 400_000)).getSummary(
        { id: 'viewer', role: 'VIEWER', username: 'viewer' },
        { from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T23:59:59.999Z' },
      ),
    ).resolves.toEqual({
      awaitingApprovalCount: 1,
      completedCount: 3,
      medianDurationMs: 200_000,
      queuedCount: 1,
      runningCount: 1,
      statuses: { cancelled: 0, failed: 1, skipped: 1, success: 1, unknown: 0 },
      successRate: 50,
      totalRunDurationMs: 1_000_000,
    });
    expect(workflowRuns.getReadAbility).toHaveBeenCalledTimes(1);
    expect(workflowRuns.findMany).toHaveBeenCalledTimes(1);
    expect(workflowRuns.findCurrent).toHaveBeenCalledWith(
      {
        select: { awaitingApproval: true, durationMs: true, status: true },
        where: { status: { in: ['QUEUED', 'RUNNING'] } },
      },
      ability,
    );
  });

  it('ranks visible repository health by failures and success rate', async () => {
    const ability = {};
    const repositoryA = { id: 'repository-a', name: 'alpha', owner: 'ezrepo', url: 'https://example.test/alpha' };
    const repositoryB = { id: 'repository-b', name: 'beta', owner: 'ezrepo', url: 'https://example.test/beta' };
    const workflowRuns = {
      findMany: jest.fn().mockResolvedValue([
        { durationMs: 100_000, repository: repositoryA, status: 'SUCCESS' },
        { durationMs: 300_000, repository: repositoryA, status: 'FAILED' },
        { durationMs: null, repository: repositoryA, status: 'SKIPPED' },
        { durationMs: 120_000, repository: repositoryB, status: 'SUCCESS' },
        { durationMs: 180_000, repository: repositoryB, status: 'SUCCESS' },
      ]),
      getReadAbility: jest.fn().mockResolvedValue(ability),
    } as unknown as WorkflowRunsQueryService;

    await expect(
      new DashboardService(workflowRuns, prisma()).getRepositoryHealth(
        { id: 'viewer', role: 'VIEWER', username: 'viewer' },
        { from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T23:59:59.999Z' },
      ),
    ).resolves.toEqual([
      {
        completedCount: 3,
        failedCount: 1,
        medianDurationMs: 200_000,
        repository: repositoryA,
        successRate: 50,
      },
      {
        completedCount: 2,
        failedCount: 0,
        medianDurationMs: 150_000,
        repository: repositoryB,
        successRate: 100,
      },
    ]);
    expect(workflowRuns.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          completedAt: { gte: '2026-08-01T00:00:00.000Z', lte: '2026-08-31T23:59:59.999Z' },
          status: { in: ['SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED', 'UNKNOWN'] },
        },
      }),
      ability,
    );
  });

  it('rejects an inverted trend time range before reading workflow runs', async () => {
    const workflowRuns = { getReadAbility: jest.fn() } as unknown as WorkflowRunsQueryService;

    await expect(
      new DashboardService(workflowRuns, prisma()).getTrend(
        { id: 'viewer', role: 'VIEWER', username: 'viewer' },
        { bucket: 'hour', from: '2026-08-27T00:00:00.000Z', to: '2026-08-26T00:00:00.000Z' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(workflowRuns.getReadAbility).not.toHaveBeenCalled();
  });

  it('does not aggregate workflow activity from repositories outside the user membership', async () => {
    const visibleRuns = [
      run({
        completedAt: '2026-08-26T10:00:00.000Z',
        repositoryId: 'repository-a',
        status: 'FAILED',
        workflowName: 'Visible test',
      }),
      run({
        completedAt: '2026-08-26T10:00:00.000Z',
        repositoryId: 'repository-b',
        status: 'FAILED',
        workflowName: 'Private test',
      }),
    ];
    const prisma = {
      repositoryMembership: {
        findMany: jest.fn().mockResolvedValue([{ repositoryId: 'repository-a', role: 'VIEWER' }]),
      },
      workflowRun: {
        findMany: jest.fn().mockImplementation((args: { take?: number; where: { AND: unknown[] } }) => {
          const accessCondition = args.where.AND[0] as { OR: { repositoryId: { in: string[] } }[] };
          const allowedRepositoryIds = accessCondition.OR.flatMap((condition) => condition.repositoryId.in);
          return visibleRuns
            .filter((workflowRun) => allowedRepositoryIds.includes(workflowRun.repositoryId))
            .slice(0, args.take);
        }),
      },
    } as unknown as PrismaService;
    const dashboard = new DashboardService(new WorkflowRunsQueryService(prisma, new CaslAbilityFactory()), prisma);
    const user = { id: 'viewer', role: 'VIEWER' as const, username: 'viewer' };

    await expect(dashboard.getLatestFailures(user)).resolves.toEqual([
      expect.objectContaining({ repositoryId: 'repository-a', workflowName: 'Visible test' }),
    ]);
    await expect(dashboard.getLatestRuns(user)).resolves.toEqual([
      expect.objectContaining({ repositoryId: 'repository-a', workflowName: 'Visible test' }),
    ]);
    await expect(
      dashboard.getTrend(user, {
        bucket: 'day',
        from: '2026-08-26T00:00:00.000Z',
        to: '2026-08-26T23:59:59.999Z',
      }),
    ).resolves.toEqual([{ bucketStart: new Date('2026-08-26T00:00:00.000Z'), errorCount: 1, successCount: 0 }]);
    expect(prisma.workflowRun.findMany).toHaveBeenCalledTimes(4);
  });
});

function run(input: {
  completedAt: string | null;
  providerCreatedAt?: string;
  repositoryId: string;
  scopeKey?: string;
  status: WorkflowRun['status'];
  workflowId?: string;
  workflowName: string;
}): WorkflowRun {
  const providerCreatedAt = input.providerCreatedAt ?? input.completedAt!;
  const workflowId = input.workflowId ?? `${input.repositoryId}-${input.workflowName}`;
  return {
    awaitingApproval: false,
    changeRequestCheckedAt: null,
    changeRequestMergedAt: null,
    changeRequestNumber: null,
    changeRequestState: 'UNKNOWN',
    changeRequestTargetBranch: null,
    completedAt: input.completedAt ? new Date(input.completedAt) : null,
    createdAt: new Date(providerCreatedAt),
    displayTitle: input.workflowName,
    durationMs: 60_000,
    event: 'push',
    headBranch: 'main',
    headSha: '0123456789abcdef',
    id: `${input.repositoryId}-${input.workflowName}-${providerCreatedAt}`,
    providerCreatedAt: new Date(providerCreatedAt),
    pullRequestId: null,
    providerRunId: providerCreatedAt,
    rawStatus: input.status.toLowerCase(),
    reviewUrl: null,
    repositoryId: input.repositoryId,
    scopeKey: input.scopeKey ?? 'branch:main',
    startedAt: new Date(providerCreatedAt),
    status: input.status,
    updatedAt: new Date(providerCreatedAt),
    url: 'https://example.test/run',
    workflowId,
    workflowName: input.workflowName,
  };
}
