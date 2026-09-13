import type { PrismaService } from '../../prisma/prisma.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { WorkflowFilterService } from '../repositories/workflow-filter.service.js';
import type { SystemStatusService } from '../system-status/system-status.service.js';
import type { ProviderAdapterRegistry } from './provider-adapter.registry.js';
import type { ProviderCredentialService } from './provider-credential.service.js';
import { ProviderSyncService } from './sync.service.js';

describe('ProviderSyncService', () => {
  it('upserts repeated provider-native run IDs within each repository', async () => {
    const firstRepository = createRepository('first-repository');
    const secondRepository = createRepository('second-repository');
    const mocks = {
      prisma: {
        providerAccount: { update: jest.fn().mockResolvedValue(undefined) },
        repository: {
          findMany: jest.fn().mockResolvedValue([firstRepository, secondRepository]),
          update: jest.fn().mockResolvedValue(undefined),
        },
        workflowRun: {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          upsert: jest.fn(({ create }) => Promise.resolve({ id: 'run-id', ...create })),
        },
        workflow: {
          delete: jest.fn().mockResolvedValue(undefined),
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn().mockResolvedValue({ id: 'workflow-id' }),
        },
      },
      adapter: {
        getWorkflowRun: jest.fn().mockResolvedValue(createWorkflowRun()),
        listWorkflowRuns: jest.fn().mockResolvedValue([createWorkflowRun()]),
      },
      credentials: { decrypt: jest.fn().mockReturnValue('access-token') },
      filters: { shouldTrack: jest.fn().mockReturnValue(true) },
      notifications: { evaluateRulesForRun: jest.fn().mockResolvedValue([]) },
      status: {
        beginProviderSync: jest.fn().mockReturnValue('sync-id'),
        finishProviderSync: jest.fn(),
        refreshRunningWorkflowCount: jest.fn().mockResolvedValue(undefined),
        updateProviderSync: jest.fn(),
      },
    };
    const service = new ProviderSyncService(
      mocks.prisma as unknown as PrismaService,
      { get: jest.fn().mockReturnValue(mocks.adapter) } as unknown as ProviderAdapterRegistry,
      mocks.credentials as unknown as ProviderCredentialService,
      { refresh: jest.fn((repository) => Promise.resolve(repository)) } as never,
      mocks.filters as unknown as WorkflowFilterService,
      mocks.notifications as unknown as NotificationsService,
      mocks.status as unknown as SystemStatusService,
    );

    await service.syncEnabledRepositories();
    await service.syncEnabledRepositories();

    const { providerWorkflowId, workflowKind, workflowPath, ...persistedRun } = createWorkflowRun();
    expect(mocks.prisma.workflow.upsert).toHaveBeenCalledTimes(4);
    expect(mocks.prisma.workflow.upsert).toHaveBeenNthCalledWith(1, {
      create: {
        kind: workflowKind,
        lastSeenAt: expect.any(Date),
        name: persistedRun.workflowName,
        path: workflowPath,
        providerWorkflowId,
        repositoryId: firstRepository.id,
      },
      update: {
        kind: workflowKind,
        lastSeenAt: expect.any(Date),
        name: persistedRun.workflowName,
        path: workflowPath,
      },
      where: {
        repositoryId_providerWorkflowId: {
          providerWorkflowId,
          repositoryId: firstRepository.id,
        },
      },
    });
    expect(mocks.prisma.workflowRun.upsert).toHaveBeenCalledTimes(4);
    expect(mocks.prisma.workflowRun.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.workflow.delete).not.toHaveBeenCalled();
    expect(mocks.adapter.getWorkflowRun).not.toHaveBeenCalled();
    expect(mocks.prisma.workflowRun.upsert).toHaveBeenNthCalledWith(1, {
      create: { ...persistedRun, repositoryId: firstRepository.id, workflowId: 'workflow-id' },
      update: { ...persistedRun, workflowId: 'workflow-id' },
      where: {
        repositoryId_providerRunId: {
          providerRunId: '12345',
          repositoryId: firstRepository.id,
        },
      },
    });
    expect(mocks.prisma.workflowRun.upsert).toHaveBeenNthCalledWith(2, {
      create: { ...persistedRun, repositoryId: secondRepository.id, workflowId: 'workflow-id' },
      update: { ...persistedRun, workflowId: 'workflow-id' },
      where: {
        repositoryId_providerRunId: {
          providerRunId: '12345',
          repositoryId: secondRepository.id,
        },
      },
    });
    expect(mocks.notifications.evaluateRulesForRun).toHaveBeenCalledTimes(4);
    expect(mocks.status.refreshRunningWorkflowCount).toHaveBeenCalledTimes(4);
    expect(mocks.status.updateProviderSync).toHaveBeenCalledWith('sync-id', {
      phase: 'PROCESSING_WORKFLOWS',
      repositoriesCompleted: 0,
      repositoriesTotal: 2,
      workflowRunsCompleted: 0,
      workflowRunsTotal: 1,
    });
    expect(mocks.status.finishProviderSync).toHaveBeenCalledTimes(2);
  });

  it('moves migrated name-based runs to their provider-native workflow on first observation', async () => {
    const repository = createRepository('repository');
    const run = createWorkflowRun();
    const prisma = {
      providerAccount: { update: jest.fn().mockResolvedValue(undefined) },
      repository: {
        findMany: jest.fn().mockResolvedValue([repository]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      workflow: {
        delete: jest.fn().mockResolvedValue(undefined),
        findUnique: jest.fn().mockResolvedValue({ id: 'legacy-workflow-id' }),
        upsert: jest.fn().mockResolvedValue({ id: 'provider-workflow-id' }),
      },
      workflowRun: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 3 }),
        upsert: jest.fn(({ create }) => Promise.resolve({ id: 'run-id', ...create })),
      },
    };
    const status = {
      beginProviderSync: jest.fn().mockReturnValue('sync-id'),
      finishProviderSync: jest.fn(),
      refreshRunningWorkflowCount: jest.fn().mockResolvedValue(undefined),
      updateProviderSync: jest.fn(),
    };
    const service = new ProviderSyncService(
      prisma as unknown as PrismaService,
      {
        get: jest.fn().mockReturnValue({
          getWorkflowRun: jest.fn(),
          listWorkflowRuns: jest.fn().mockResolvedValue([run]),
        }),
      } as unknown as ProviderAdapterRegistry,
      { decrypt: jest.fn().mockReturnValue('access-token') } as unknown as ProviderCredentialService,
      { refresh: jest.fn((value) => Promise.resolve(value)) } as never,
      { shouldTrack: jest.fn().mockReturnValue(true) } as unknown as WorkflowFilterService,
      { evaluateRulesForRun: jest.fn().mockResolvedValue([]) } as unknown as NotificationsService,
      status as unknown as SystemStatusService,
    );

    await service.syncEnabledRepositories();

    expect(prisma.workflow.findUnique).toHaveBeenCalledWith({
      where: {
        repositoryId_providerWorkflowId: {
          providerWorkflowId: 'legacy:name:Test',
          repositoryId: repository.id,
        },
      },
    });
    expect(prisma.workflowRun.updateMany).toHaveBeenCalledWith({
      data: { scopeKey: 'branch:main', workflowId: 'provider-workflow-id' },
      where: { workflowId: 'legacy-workflow-id' },
    });
    expect(prisma.workflow.delete).toHaveBeenCalledWith({ where: { id: 'legacy-workflow-id' } });
  });

  it('refreshes current active and failed workflow contexts', async () => {
    const repository = createRepository('repository');
    const refreshedApproval = { ...createWorkflowRun(), providerRunId: 'current-approval' };
    const refreshedFailure = { ...createWorkflowRun(), providerRunId: 'current-failure', status: 'SUCCESS' as const };
    const prisma = {
      providerAccount: { update: jest.fn().mockResolvedValue(undefined) },
      repository: {
        findMany: jest.fn().mockResolvedValue([repository]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      workflow: {
        delete: jest.fn().mockResolvedValue(undefined),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'workflow-id' }),
      },
      workflowRun: {
        findMany: jest.fn().mockResolvedValue([
          { awaitingApproval: false, providerRunId: 'new-success', status: 'SUCCESS' },
          { awaitingApproval: true, providerRunId: 'current-approval', status: 'QUEUED' },
          { awaitingApproval: false, providerRunId: 'current-failure', status: 'FAILED' },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn(({ create }) => Promise.resolve({ id: 'run-id', ...create })),
      },
    };
    const adapter = {
      getWorkflowRun: jest.fn((_, __, providerRunId: string) =>
        Promise.resolve(providerRunId === 'current-failure' ? refreshedFailure : refreshedApproval),
      ),
      listWorkflowRuns: jest.fn().mockResolvedValue([]),
    };
    const service = new ProviderSyncService(
      prisma as unknown as PrismaService,
      { get: jest.fn().mockReturnValue(adapter) } as unknown as ProviderAdapterRegistry,
      { decrypt: jest.fn().mockReturnValue('access-token') } as unknown as ProviderCredentialService,
      { refresh: jest.fn((value) => Promise.resolve(value)) } as never,
      { shouldTrack: jest.fn().mockReturnValue(true) } as unknown as WorkflowFilterService,
      { evaluateRulesForRun: jest.fn().mockResolvedValue([]) } as unknown as NotificationsService,
      {
        beginProviderSync: jest.fn().mockReturnValue('sync-id'),
        finishProviderSync: jest.fn(),
        refreshRunningWorkflowCount: jest.fn(),
        updateProviderSync: jest.fn(),
      } as unknown as SystemStatusService,
    );

    await service.syncEnabledRepositories();

    expect(prisma.workflowRun.findMany).toHaveBeenCalledWith({
      distinct: ['workflowId', 'scopeKey'],
      orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
      select: { awaitingApproval: true, providerRunId: true, status: true },
      where: { repositoryId: repository.id },
    });
    expect(adapter.getWorkflowRun).toHaveBeenCalledTimes(2);
    expect(adapter.getWorkflowRun).toHaveBeenCalledWith(expect.anything(), repository, 'current-approval');
    expect(adapter.getWorkflowRun).toHaveBeenCalledWith(expect.anything(), repository, 'current-failure');
    expect(prisma.workflowRun.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.workflowRun.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ providerRunId: 'current-failure', status: 'SUCCESS' }),
      }),
    );
  });

  it('refreshes current failed pull-request runs missing their change-request context', async () => {
    const repository = createRepository('repository');
    const refreshedFailure = {
      ...createWorkflowRun(),
      changeRequestNumber: '14',
      event: 'pull_request',
      providerRunId: 'missing-change-request',
      scopeKey: 'change-request:14',
      status: 'FAILED' as const,
    };
    const prisma = {
      providerAccount: { update: jest.fn().mockResolvedValue(undefined) },
      repository: {
        findMany: jest.fn().mockResolvedValue([repository]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      workflow: {
        delete: jest.fn().mockResolvedValue(undefined),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'workflow-id' }),
      },
      workflowRun: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              awaitingApproval: false,
              providerRunId: 'missing-change-request',
              status: 'FAILED',
            },
          ])
          .mockResolvedValueOnce([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn(({ create }) => Promise.resolve({ id: 'run-id', ...create })),
      },
    };
    const adapter = {
      getWorkflowRun: jest.fn().mockResolvedValue(refreshedFailure),
      listWorkflowRuns: jest.fn().mockResolvedValue([]),
    };
    const service = new ProviderSyncService(
      prisma as unknown as PrismaService,
      { get: jest.fn().mockReturnValue(adapter) } as unknown as ProviderAdapterRegistry,
      { decrypt: jest.fn().mockReturnValue('access-token') } as unknown as ProviderCredentialService,
      { refresh: jest.fn((value) => Promise.resolve(value)) } as never,
      { shouldTrack: jest.fn().mockReturnValue(true) } as unknown as WorkflowFilterService,
      { evaluateRulesForRun: jest.fn().mockResolvedValue([]) } as unknown as NotificationsService,
      {
        beginProviderSync: jest.fn().mockReturnValue('sync-id'),
        finishProviderSync: jest.fn(),
        refreshRunningWorkflowCount: jest.fn(),
        updateProviderSync: jest.fn(),
      } as unknown as SystemStatusService,
    );

    await service.syncEnabledRepositories();

    expect(adapter.getWorkflowRun).toHaveBeenCalledWith(expect.anything(), repository, 'missing-change-request');
    expect(prisma.workflowRun.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ changeRequestNumber: '14', scopeKey: 'change-request:14' }),
      }),
    );
  });

  it('deduplicates and persists change-request lifecycle refreshes for current failures', async () => {
    const repository = createRepository('repository');
    const prisma = {
      providerAccount: { update: jest.fn().mockResolvedValue(undefined) },
      repository: {
        findMany: jest.fn().mockResolvedValue([repository]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      workflowRun: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              changeRequestCheckedAt: null,
              changeRequestNumber: '42',
              changeRequestState: 'UNKNOWN',
              status: 'FAILED',
            },
            {
              changeRequestCheckedAt: null,
              changeRequestNumber: '42',
              changeRequestState: 'UNKNOWN',
              status: 'FAILED',
            },
          ]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const adapter = {
      getChangeRequestState: jest.fn().mockResolvedValue({
        mergedAt: null,
        state: 'CLOSED',
        targetBranch: 'main',
      }),
      getWorkflowRun: jest.fn(),
      listWorkflowRuns: jest.fn().mockResolvedValue([]),
    };
    const service = new ProviderSyncService(
      prisma as unknown as PrismaService,
      { get: jest.fn().mockReturnValue(adapter) } as unknown as ProviderAdapterRegistry,
      { decrypt: jest.fn().mockReturnValue('access-token') } as unknown as ProviderCredentialService,
      { refresh: jest.fn((value) => Promise.resolve(value)) } as never,
      { shouldTrack: jest.fn() } as unknown as WorkflowFilterService,
      { evaluateRulesForRun: jest.fn() } as unknown as NotificationsService,
      {
        beginProviderSync: jest.fn().mockReturnValue('sync-id'),
        finishProviderSync: jest.fn(),
        refreshRunningWorkflowCount: jest.fn(),
        updateProviderSync: jest.fn(),
      } as unknown as SystemStatusService,
    );

    await service.syncEnabledRepositories();

    expect(adapter.getChangeRequestState).toHaveBeenCalledTimes(1);
    expect(adapter.getChangeRequestState).toHaveBeenCalledWith(expect.anything(), repository, '42');
    expect(prisma.workflowRun.updateMany).toHaveBeenCalledWith({
      data: {
        changeRequestCheckedAt: expect.any(Date),
        changeRequestMergedAt: null,
        changeRequestState: 'CLOSED',
        changeRequestTargetBranch: 'main',
      },
      where: { changeRequestNumber: '42', repositoryId: repository.id },
    });
  });

  it('reports a failed change-request lifecycle lookup to the durable queue', async () => {
    const repository = createRepository('repository');
    const prisma = {
      providerAccount: { update: jest.fn().mockResolvedValue(undefined) },
      repository: {
        findMany: jest.fn().mockResolvedValue([repository]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      workflowRun: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              changeRequestCheckedAt: null,
              changeRequestNumber: '42',
              changeRequestState: 'UNKNOWN',
              status: 'FAILED',
            },
          ]),
        updateMany: jest.fn(),
      },
    };
    const adapter = {
      getChangeRequestState: jest.fn().mockRejectedValue(new Error('provider unavailable')),
      getWorkflowRun: jest.fn(),
      listWorkflowRuns: jest.fn().mockResolvedValue([]),
    };
    const service = new ProviderSyncService(
      prisma as unknown as PrismaService,
      { get: jest.fn().mockReturnValue(adapter) } as unknown as ProviderAdapterRegistry,
      { decrypt: jest.fn().mockReturnValue('access-token') } as unknown as ProviderCredentialService,
      { refresh: jest.fn((value) => Promise.resolve(value)) } as never,
      { shouldTrack: jest.fn() } as unknown as WorkflowFilterService,
      { evaluateRulesForRun: jest.fn() } as unknown as NotificationsService,
      {
        beginProviderSync: jest.fn().mockReturnValue('sync-id'),
        finishProviderSync: jest.fn(),
        refreshRunningWorkflowCount: jest.fn(),
        updateProviderSync: jest.fn(),
      } as unknown as SystemStatusService,
    );

    await expect(service.syncEnabledRepositories()).rejects.toThrow('provider unavailable');

    expect(adapter.getChangeRequestState).toHaveBeenCalledTimes(1);
    expect(prisma.workflowRun.updateMany).not.toHaveBeenCalled();
    expect(prisma.repository.update).not.toHaveBeenCalled();
    expect(prisma.providerAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastSyncError: 'Synchronization failed. Check provider connectivity and credentials.',
        }),
      }),
    );
  });

  it('uses refreshed repository metadata for workflow requests', async () => {
    const repository = createRepository('repository');
    const adapter = { getWorkflowRun: jest.fn(), listWorkflowRuns: jest.fn().mockResolvedValue([]) };
    const metadata = {
      refresh: jest.fn().mockResolvedValue({
        ...repository,
        name: 'renamed',
        owner: 'new-owner',
        url: 'https://github.com/new-owner/renamed',
      }),
    };
    const prisma = {
      providerAccount: { update: jest.fn().mockResolvedValue(undefined) },
      repository: {
        findMany: jest.fn().mockResolvedValue([repository]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      workflowRun: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ProviderSyncService(
      prisma as unknown as PrismaService,
      { get: jest.fn().mockReturnValue(adapter) } as unknown as ProviderAdapterRegistry,
      { decrypt: jest.fn().mockReturnValue('access-token') } as unknown as ProviderCredentialService,
      metadata as never,
      { shouldTrack: jest.fn() } as unknown as WorkflowFilterService,
      { evaluateRulesForRun: jest.fn() } as unknown as NotificationsService,
      {
        beginProviderSync: jest.fn().mockReturnValue('sync-id'),
        finishProviderSync: jest.fn(),
        refreshRunningWorkflowCount: jest.fn(),
        updateProviderSync: jest.fn(),
      } as unknown as SystemStatusService,
    );

    await service.syncEnabledRepositories();

    expect(metadata.refresh).toHaveBeenCalledWith(repository);
    expect(adapter.listWorkflowRuns).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'renamed', owner: 'new-owner' }),
      undefined,
    );
  });

  it('records the synchronization start as the next incremental cursor', async () => {
    jest.useFakeTimers();
    const synchronizationStartedAt = new Date('2026-09-13T10:00:00.000Z');
    const synchronizationFinishedAt = new Date('2026-09-13T10:05:00.000Z');
    jest.setSystemTime(synchronizationStartedAt);
    const repository = createRepository('repository');
    const prisma = {
      providerAccount: { update: jest.fn().mockResolvedValue(undefined) },
      repository: {
        findMany: jest.fn().mockResolvedValue([repository]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      workflowRun: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const adapter = {
      getWorkflowRun: jest.fn(),
      listWorkflowRuns: jest.fn().mockImplementation(async () => {
        jest.setSystemTime(synchronizationFinishedAt);
        return [];
      }),
    };
    const service = new ProviderSyncService(
      prisma as unknown as PrismaService,
      { get: jest.fn().mockReturnValue(adapter) } as unknown as ProviderAdapterRegistry,
      { decrypt: jest.fn().mockReturnValue('access-token') } as unknown as ProviderCredentialService,
      { refresh: jest.fn((value) => Promise.resolve(value)) } as never,
      { shouldTrack: jest.fn() } as unknown as WorkflowFilterService,
      { evaluateRulesForRun: jest.fn() } as unknown as NotificationsService,
      {
        beginProviderSync: jest.fn().mockReturnValue('sync-id'),
        finishProviderSync: jest.fn(),
        refreshRunningWorkflowCount: jest.fn(),
        updateProviderSync: jest.fn(),
      } as unknown as SystemStatusService,
    );

    try {
      await service.syncEnabledRepositories();
    } finally {
      jest.useRealTimers();
    }

    expect(prisma.repository.update).toHaveBeenCalledWith({
      data: { lastSyncAt: synchronizationStartedAt },
      where: { id: repository.id },
    });
    expect(prisma.providerAccount.update).toHaveBeenCalledWith({
      data: { lastSyncAt: synchronizationStartedAt, lastSyncError: null },
      where: { id: repository.providerAccount.id },
    });
  });

  it('does not advance the workflow cursor for a work-item-only synchronization', async () => {
    const repository = createRepository('repository');
    const prisma = {
      providerAccount: { update: jest.fn().mockResolvedValue(undefined) },
      repository: {
        findFirst: jest.fn().mockResolvedValue(repository),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const workItems = { synchronize: jest.fn().mockResolvedValue(undefined) };
    const service = new ProviderSyncService(
      prisma as unknown as PrismaService,
      { get: jest.fn().mockReturnValue({}) } as unknown as ProviderAdapterRegistry,
      { decrypt: jest.fn().mockReturnValue('access-token') } as unknown as ProviderCredentialService,
      { refresh: jest.fn((value) => Promise.resolve(value)) } as never,
      { shouldTrack: jest.fn() } as unknown as WorkflowFilterService,
      { evaluateRulesForRun: jest.fn() } as unknown as NotificationsService,
      {
        beginProviderSync: jest.fn().mockReturnValue('sync-id'),
        finishProviderSync: jest.fn(),
        refreshRunningWorkflowCount: jest.fn(),
        updateProviderSync: jest.fn(),
      } as unknown as SystemStatusService,
      workItems as never,
    );

    await expect(service.syncRepositoryById(repository.id, ['ISSUES'])).resolves.toBe(true);

    expect(workItems.synchronize).toHaveBeenCalledWith(
      expect.anything(),
      repository,
      expect.anything(),
      ['ISSUES'],
      undefined,
    );
    expect(prisma.repository.update).not.toHaveBeenCalled();
    expect(prisma.providerAccount.update).toHaveBeenCalledWith({
      data: { lastSyncAt: expect.any(Date), lastSyncError: null },
      where: { id: repository.providerAccount.id },
    });
  });
});

function createRepository(id: string) {
  return {
    id,
    lastSyncAt: null,
    name: 'ezrepo',
    owner: 'ezrepo',
    providerRepositoryId: 'repository-id',
    providerAccount: {
      baseUrl: null,
      encryptedAccessToken: 'encrypted-access-token',
      id: 'provider-account',
      providerType: 'GITHUB',
    },
    workflowFilters: [],
  };
}

function createWorkflowRun() {
  return {
    awaitingApproval: false,
    changeRequestNumber: null,
    completedAt: new Date('2026-08-26T09:10:00.000Z'),
    displayTitle: 'Test on main',
    durationMs: 60_000,
    event: 'push',
    headBranch: 'main',
    headSha: '0123456789abcdef',
    providerCreatedAt: new Date('2026-08-26T09:09:00.000Z'),
    providerRunId: '12345',
    providerWorkflowId: '17',
    rawStatus: 'success',
    reviewUrl: null,
    scopeKey: 'branch:main',
    startedAt: new Date('2026-08-26T09:09:00.000Z'),
    status: 'SUCCESS',
    url: 'https://github.com/ezrepo/ezrepo/actions/runs/12345',
    workflowKind: 'STANDARD',
    workflowName: 'Test',
    workflowPath: '.github/workflows/test.yml',
  };
}
