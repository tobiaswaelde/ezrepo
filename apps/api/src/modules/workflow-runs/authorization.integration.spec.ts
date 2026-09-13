import { CaslAbilityFactory } from '../../casl/casl-ability.factory.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TestDatabaseService } from '../../prisma/test-database.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { DashboardService } from '../dashboard/dashboard.service.js';
import { WorkflowRunsQueryService } from './workflow-runs-query.service.js';

/** Verify persisted CASL restrictions through real PostgreSQL queries and dashboard aggregates. */
describe('workflow-run authorization integration', () => {
  const prisma = new PrismaService();
  const database = new TestDatabaseService(prisma);
  const runs = new WorkflowRunsQueryService(prisma, new CaslAbilityFactory());
  const dashboard = new DashboardService(runs, prisma);

  let users: Record<'admin' | 'manager' | 'viewer' | 'outsider', AuthenticatedUser>;
  let visibleRunId: string;
  let hiddenRunId: string;
  let visibleWorkflowId: string;

  beforeAll(async () => prisma.onModuleInit());
  beforeEach(async () => {
    await database.cleanup();

    const account = await prisma.providerAccount.create({
      data: {
        displayName: 'Integration provider',
        encryptedAccessToken: 'encrypted-token',
        providerType: 'GITHUB',
      },
    });
    const [visibleRepository, hiddenRepository] = await Promise.all([
      prisma.repository.create({
        data: {
          name: 'visible',
          owner: 'ezrepo',
          providerAccountId: account.id,
          providerRepositoryId: 'visible',
          url: 'https://github.com/ezrepo/visible',
        },
      }),
      prisma.repository.create({
        data: {
          name: 'hidden',
          owner: 'ezrepo',
          providerAccountId: account.id,
          providerRepositoryId: 'hidden',
          url: 'https://github.com/ezrepo/hidden',
        },
      }),
    ]);
    const [admin, manager, viewer, outsider] = await Promise.all([
      prisma.user.create({ data: { passwordHash: 'hash', role: 'SYSTEM_ADMIN', username: 'admin' } }),
      prisma.user.create({ data: { passwordHash: 'hash', role: 'MANAGER', username: 'manager' } }),
      prisma.user.create({ data: { passwordHash: 'hash', role: 'VIEWER', username: 'viewer' } }),
      prisma.user.create({ data: { passwordHash: 'hash', role: 'VIEWER', username: 'outsider' } }),
    ]);
    await Promise.all([
      prisma.repositoryMembership.create({
        data: { repositoryId: visibleRepository.id, role: 'MANAGER', userId: manager.id },
      }),
      prisma.repositoryMembership.create({
        data: { repositoryId: visibleRepository.id, role: 'VIEWER', userId: viewer.id },
      }),
    ]);
    const [visibleWorkflow, hiddenWorkflow] = await Promise.all([
      prisma.workflow.create({
        data: {
          lastSeenAt: new Date('2026-08-26T10:00:00.000Z'),
          name: 'Visible workflow',
          path: '.github/workflows/visible.yml',
          providerWorkflowId: 'visible-workflow',
          repositoryId: visibleRepository.id,
        },
      }),
      prisma.workflow.create({
        data: {
          lastSeenAt: new Date('2026-08-26T10:00:00.000Z'),
          name: 'Hidden workflow',
          path: '.github/workflows/hidden.yml',
          providerWorkflowId: 'hidden-workflow',
          repositoryId: hiddenRepository.id,
        },
      }),
    ]);
    const createdAt = new Date('2026-08-26T10:00:00.000Z');
    const [visibleRun, hiddenRun] = await Promise.all([
      prisma.workflowRun.create({
        data: {
          completedAt: createdAt,
          displayTitle: 'Visible workflow',
          providerCreatedAt: createdAt,
          providerRunId: 'visible-run',
          rawStatus: 'failure',
          repositoryId: visibleRepository.id,
          scopeKey: 'branch:main',
          status: 'FAILED',
          url: 'https://github.com/ezrepo/visible/actions/runs/1',
          workflowName: 'Visible workflow',
          workflowId: visibleWorkflow.id,
        },
      }),
      prisma.workflowRun.create({
        data: {
          completedAt: createdAt,
          displayTitle: 'Hidden workflow',
          providerCreatedAt: createdAt,
          providerRunId: 'hidden-run',
          rawStatus: 'success',
          repositoryId: hiddenRepository.id,
          scopeKey: 'branch:main',
          status: 'SUCCESS',
          url: 'https://github.com/ezrepo/hidden/actions/runs/1',
          workflowName: 'Hidden workflow',
          workflowId: hiddenWorkflow.id,
        },
      }),
    ]);
    users = {
      admin: { id: admin.id, role: admin.role, username: admin.username },
      manager: { id: manager.id, role: manager.role, username: manager.username },
      outsider: { id: outsider.id, role: outsider.role, username: outsider.username },
      viewer: { id: viewer.id, role: viewer.role, username: viewer.username },
    };
    hiddenRunId = hiddenRun.id;
    visibleRunId = visibleRun.id;
    visibleWorkflowId = visibleWorkflow.id;
  });
  afterAll(async () => prisma.onModuleDestroy());

  it.each([
    ['admin', [expect.any(String), expect.any(String)], 1, 1],
    ['manager', [expect.any(String)], 1, 0],
    ['viewer', [expect.any(String)], 1, 0],
    ['outsider', [], 0, 0],
  ] as const)(
    '%s sees only permitted runs in lists, failures, summaries, trends, and repository health',
    async (role, expectedRunIds, failures, successes) => {
      const user = users[role];
      const ability = await runs.getReadAbility(user);
      const visible = await runs.findMany<{ id: string }>({ orderBy: { id: 'asc' } }, ability);

      expect(visible.map((run) => run.id)).toEqual(expectedRunIds);
      if (role === 'admin')
        expect(visible.map((run) => run.id)).toEqual(expect.arrayContaining([visibleRunId, hiddenRunId]));
      if (role !== 'admin') expect(visible.map((run) => run.id)).not.toContain(hiddenRunId);

      await expect(dashboard.getLatestFailures(user)).resolves.toHaveLength(failures);
      await expect(
        dashboard.getSummary(user, {
          from: '2026-08-26T00:00:00.000Z',
          to: '2026-08-26T23:59:59.999Z',
        }),
      ).resolves.toMatchObject({
        awaitingApprovalCount: 0,
        completedCount: failures + successes,
        queuedCount: 0,
        runningCount: 0,
        statuses: { failed: failures, success: successes },
      });
      await expect(
        dashboard.getTrend(user, {
          bucket: 'day',
          from: '2026-08-26T00:00:00.000Z',
          to: '2026-08-26T23:59:59.999Z',
        }),
      ).resolves.toEqual([
        { bucketStart: new Date('2026-08-26T00:00:00.000Z'), errorCount: failures, successCount: successes },
      ]);
      await expect(
        dashboard.getRepositoryHealth(user, {
          from: '2026-08-26T00:00:00.000Z',
          to: '2026-08-26T23:59:59.999Z',
        }),
      ).resolves.toHaveLength(failures + successes);
    },
  );

  it('removes a failed provider run after the same run is refreshed as successful', async () => {
    const ability = await runs.getReadAbility(users.viewer);

    await expect(runs.findNeedsAttention<{ id: string }>({ select: { id: true } }, ability)).resolves.toEqual([
      { id: visibleRunId },
    ]);

    await prisma.workflowRun.update({
      data: { rawStatus: 'success', status: 'SUCCESS' },
      where: { id: visibleRunId },
    });

    await expect(runs.findNeedsAttention<{ id: string }>({ select: { id: true } }, ability)).resolves.toEqual([]);
  });

  it('keeps only actionable change-request failures after closure or a successful merge validation', async () => {
    const previousFailure = await prisma.workflowRun.findUniqueOrThrow({ where: { id: visibleRunId } });
    const mergeTime = new Date('2026-08-26T11:00:00.000Z');
    const createRun = async (input: {
      changeRequestNumber?: string;
      changeRequestState?: 'OPEN' | 'CLOSED' | 'MERGED';
      changeRequestTargetBranch?: string;
      providerCreatedAt: Date;
      providerRunId: string;
      scopeKey: string;
      status: 'FAILED' | 'SUCCESS';
      workflowId?: string;
    }) =>
      prisma.workflowRun.create({
        data: {
          changeRequestMergedAt: input.changeRequestState === 'MERGED' ? mergeTime : null,
          changeRequestNumber: input.changeRequestNumber ?? null,
          changeRequestState: input.changeRequestState ?? 'UNKNOWN',
          changeRequestTargetBranch: input.changeRequestTargetBranch ?? null,
          completedAt: input.providerCreatedAt,
          displayTitle: input.providerRunId,
          providerCreatedAt: input.providerCreatedAt,
          providerRunId: input.providerRunId,
          rawStatus: input.status.toLowerCase(),
          repositoryId: previousFailure.repositoryId,
          scopeKey: input.scopeKey,
          status: input.status,
          url: `https://github.com/ezrepo/visible/actions/runs/${input.providerRunId}`,
          workflowId: input.workflowId ?? previousFailure.workflowId,
          workflowName: previousFailure.workflowName,
        },
      });
    const openFailure = await createRun({
      changeRequestNumber: '40',
      changeRequestState: 'OPEN',
      changeRequestTargetBranch: 'main',
      providerCreatedAt: new Date('2026-08-26T10:00:00.000Z'),
      providerRunId: 'open-failure',
      scopeKey: 'change-request:40',
      status: 'FAILED',
    });
    const closedFailure = await createRun({
      changeRequestNumber: '41',
      changeRequestState: 'CLOSED',
      changeRequestTargetBranch: 'main',
      providerCreatedAt: new Date('2026-08-26T10:10:00.000Z'),
      providerRunId: 'closed-failure',
      scopeKey: 'change-request:41',
      status: 'FAILED',
    });
    const resolvedMerge = await createRun({
      changeRequestNumber: '42',
      changeRequestState: 'MERGED',
      changeRequestTargetBranch: 'main',
      providerCreatedAt: new Date('2026-08-26T10:20:00.000Z'),
      providerRunId: 'resolved-merge',
      scopeKey: 'change-request:42',
      status: 'FAILED',
    });
    const unresolvedMerge = await createRun({
      changeRequestNumber: '43',
      changeRequestState: 'MERGED',
      changeRequestTargetBranch: 'release',
      providerCreatedAt: new Date('2026-08-26T10:30:00.000Z'),
      providerRunId: 'unresolved-merge',
      scopeKey: 'change-request:43',
      status: 'FAILED',
    });
    await createRun({
      providerCreatedAt: new Date('2026-08-26T12:00:00.000Z'),
      providerRunId: 'main-success-after-merge',
      scopeKey: 'branch:main',
      status: 'SUCCESS',
    });
    await createRun({
      providerCreatedAt: new Date('2026-08-26T12:10:00.000Z'),
      providerRunId: 'unrelated-branch-success',
      scopeKey: 'branch:other',
      status: 'SUCCESS',
    });

    const ability = await runs.getReadAbility(users.viewer);
    const needsAttention = await runs.findNeedsAttention<{ id: string }>({ select: { id: true } }, ability);

    expect(needsAttention).toEqual(expect.arrayContaining([{ id: openFailure.id }, { id: unresolvedMerge.id }]));
    expect(needsAttention).not.toContainEqual({ id: closedFailure.id });
    expect(needsAttention).not.toContainEqual({ id: resolvedMerge.id });
    await expect(
      runs.findMany<{ id: string }>(
        { where: { id: { in: [closedFailure.id, resolvedMerge.id] } }, select: { id: true } },
        ability,
      ),
    ).resolves.toHaveLength(2);
  });

  it.each([
    ['RUNNING', 1],
    ['SUCCESS', 0],
  ] as const)(
    'reports an earlier failure after a newer %s run only when it remains the latest terminal result',
    async (status, expectedFailures) => {
      const previousFailure = await prisma.workflowRun.findUniqueOrThrow({ where: { id: visibleRunId } });
      const laterTimestamp = new Date('2026-08-26T11:00:00.000Z');
      await prisma.workflowRun.create({
        data: {
          completedAt: status === 'SUCCESS' ? laterTimestamp : null,
          displayTitle: previousFailure.displayTitle,
          providerCreatedAt: laterTimestamp,
          providerRunId: `later-${status.toLowerCase()}`,
          rawStatus: status.toLowerCase(),
          repositoryId: previousFailure.repositoryId,
          scopeKey: previousFailure.scopeKey,
          startedAt: laterTimestamp,
          status,
          url: `https://github.com/ezrepo/visible/actions/runs/later-${status.toLowerCase()}`,
          workflowName: previousFailure.workflowName,
          workflowId: previousFailure.workflowId,
        },
      });

      await expect(dashboard.getLatestFailures(users.viewer)).resolves.toHaveLength(expectedFailures);
    },
  );

  it('keeps superseded approvals in history while excluding them from current approval lists and counts', async () => {
    const previousRun = await prisma.workflowRun.findUniqueOrThrow({ where: { id: visibleRunId } });
    const oldApprovalTimestamp = new Date('2026-08-26T11:00:00.000Z');
    const successTimestamp = new Date('2026-08-26T12:00:00.000Z');
    const currentApprovalTimestamp = new Date('2026-08-26T13:00:00.000Z');
    const oldApproval = await prisma.workflowRun.create({
      data: {
        awaitingApproval: true,
        completedAt: oldApprovalTimestamp,
        displayTitle: 'Superseded approval',
        providerCreatedAt: oldApprovalTimestamp,
        providerRunId: 'superseded-approval',
        rawStatus: 'action_required',
        repositoryId: previousRun.repositoryId,
        scopeKey: previousRun.scopeKey,
        status: 'QUEUED',
        url: 'https://github.com/ezrepo/visible/actions/runs/superseded-approval',
        workflowId: previousRun.workflowId,
        workflowName: previousRun.workflowName,
      },
    });
    await prisma.workflowRun.create({
      data: {
        completedAt: successTimestamp,
        displayTitle: 'Current success',
        providerCreatedAt: successTimestamp,
        providerRunId: 'current-success',
        rawStatus: 'success',
        repositoryId: previousRun.repositoryId,
        scopeKey: previousRun.scopeKey,
        status: 'SUCCESS',
        url: 'https://github.com/ezrepo/visible/actions/runs/current-success',
        workflowId: previousRun.workflowId,
        workflowName: previousRun.workflowName,
      },
    });
    const currentApproval = await prisma.workflowRun.create({
      data: {
        awaitingApproval: true,
        completedAt: currentApprovalTimestamp,
        displayTitle: 'Current approval',
        providerCreatedAt: currentApprovalTimestamp,
        providerRunId: 'current-approval',
        rawStatus: 'action_required',
        repositoryId: previousRun.repositoryId,
        scopeKey: 'change-request:42',
        status: 'QUEUED',
        url: 'https://github.com/ezrepo/visible/actions/runs/current-approval',
        workflowId: previousRun.workflowId,
        workflowName: previousRun.workflowName,
      },
    });

    await expect(dashboard.getAwaitingApproval(users.viewer)).resolves.toEqual([
      expect.objectContaining({ id: currentApproval.id }),
    ]);
    await expect(
      dashboard.getSummary(users.viewer, {
        from: '2026-08-26T00:00:00.000Z',
        to: '2026-08-26T23:59:59.999Z',
      }),
    ).resolves.toMatchObject({ awaitingApprovalCount: 1, queuedCount: 1, runningCount: 0 });

    const ability = await runs.getReadAbility(users.viewer);
    await expect(
      runs.findMany<{ awaitingApproval: boolean; id: string }>({ where: { id: oldApproval.id } }, ability),
    ).resolves.toEqual([expect.objectContaining({ awaitingApproval: true, id: oldApproval.id })]);
    await expect(dashboard.getAwaitingApproval(users.outsider)).resolves.toEqual([]);
  });

  it('paginates the complete needs-attention set without leaking inaccessible runs through metadata', async () => {
    const visibleFailure = await prisma.workflowRun.findUniqueOrThrow({ where: { id: visibleRunId } });
    const secondFailure = await prisma.workflowRun.create({
      data: {
        completedAt: new Date('2026-08-26T12:00:00.000Z'),
        displayTitle: 'Visible pull request failure',
        providerCreatedAt: new Date('2026-08-26T12:00:00.000Z'),
        providerRunId: 'visible-run-2',
        rawStatus: 'failure',
        repositoryId: visibleFailure.repositoryId,
        scopeKey: 'change-request:42',
        status: 'FAILED',
        url: 'https://github.com/ezrepo/visible/actions/runs/2',
        workflowId: visibleFailure.workflowId,
        workflowName: visibleFailure.workflowName,
      },
    });
    const viewerAbility = await runs.getReadAbility(users.viewer);
    const viewerOptions = await runs.toNeedsAttentionQueryOptions(
      { page: 2, perPage: 1, select: { id: true } },
      viewerAbility,
    );
    const viewerPage = await runs.query<{ id: string }>(viewerOptions, viewerAbility);

    expect(viewerPage.pageMeta).toMatchObject({ itemCount: 2, page: 2, pageCount: 2, perPage: 1 });
    expect(viewerPage.items).toEqual([{ id: visibleRunId }]);
    expect(viewerPage.items).not.toContainEqual({ id: hiddenRunId });
    expect(secondFailure.id).not.toBe(visibleRunId);

    const outsiderAbility = await runs.getReadAbility(users.outsider);
    const outsiderOptions = await runs.toNeedsAttentionQueryOptions(
      { page: 1, perPage: 25, select: { id: true } },
      outsiderAbility,
    );
    const outsiderPage = await runs.query<{ id: string }>(outsiderOptions, outsiderAbility);
    expect(outsiderPage.pageMeta.itemCount).toBe(0);
    expect(outsiderPage.items).toEqual([]);
  });

  it('keeps internal Dependabot runs in history but excludes them from needs attention', async () => {
    const timestamp = new Date('2026-08-26T12:00:00.000Z');
    const workflow = await prisma.workflow.create({
      data: {
        kind: 'DEPENDABOT_INTERNAL',
        lastSeenAt: timestamp,
        name: 'Dependabot Updates',
        path: 'dynamic/dependabot/dependabot-updates',
        providerWorkflowId: '204858725',
        repositoryId: (await prisma.workflow.findUniqueOrThrow({ where: { id: visibleWorkflowId } })).repositoryId,
      },
    });
    const dependabotRun = await prisma.workflowRun.create({
      data: {
        completedAt: timestamp,
        displayTitle: 'npm_and_yarn in /. for brace-expansion - Update #1566127419',
        providerCreatedAt: timestamp,
        providerRunId: '34353631785',
        rawStatus: 'failure',
        repositoryId: workflow.repositoryId,
        scopeKey: 'branch:main',
        status: 'FAILED',
        url: 'https://github.com/ezrepo/visible/actions/runs/34353631785',
        workflowId: workflow.id,
        workflowName: workflow.name,
      },
    });

    const ability = await runs.getReadAbility(users.viewer);
    await expect(runs.findMany<{ id: string }>({ where: { id: dependabotRun.id } }, ability)).resolves.toHaveLength(1);
    await expect(dashboard.getLatestFailures(users.viewer)).resolves.toEqual([
      expect.objectContaining({ id: visibleRunId }),
    ]);
  });
});
