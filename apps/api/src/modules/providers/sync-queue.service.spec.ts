import type { JobRunnerService } from '../../jobs/job-runner.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ProviderRequestError } from './provider-request.error.js';
import { ProviderSyncQueueService } from './sync-queue.service.js';
import type { ProviderSyncService } from './sync.service.js';

describe('ProviderSyncQueueService', () => {
  it('enqueues repository webhooks with a 15-second database debounce', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const service = createService({
      $executeRaw: executeRaw,
      repository: { findFirst: jest.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' }) },
    });

    await expect(service.enqueueWebhookRepository('00000000-0000-0000-0000-000000000001')).resolves.toBe(true);

    const query = executeRaw.mock.calls[0]?.[0] as { values: unknown[] };
    const requestedAt = query.values[1] as Date;
    const runAfter = query.values[2] as Date;
    expect(runAfter.getTime() - requestedAt.getTime()).toBe(15_000);
  });

  it('enqueues direct repository requests without a delay', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const service = createService({ $executeRaw: executeRaw });

    await service.enqueueRepositorySync('00000000-0000-0000-0000-000000000001');

    const query = executeRaw.mock.calls[0]?.[0] as { values: unknown[] };
    const requestedAt = query.values[1] as Date;
    const runAfter = query.values[2] as Date;
    expect(runAfter.getTime()).toBe(requestedAt.getTime());
  });

  it('atomically claims one account and removes a completed request', async () => {
    const mocks = processingMocks();
    const service = createService(mocks.prisma, mocks.sync);

    await service.processDueRequests();

    expect(mocks.sync.syncRepositoryById).toHaveBeenCalledWith(
      mocks.candidate.repositoryId,
      ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS'],
      expect.any(Function),
    );
    expect(mocks.transaction.repositorySyncRequest.delete).toHaveBeenCalledWith({
      where: { id: mocks.candidate.id },
    });
    expect(mocks.transaction.providerAccount.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ syncLeaseToken: null }) }),
    );
  });

  it('retains a follow-up request when another delivery arrives during synchronization', async () => {
    const mocks = processingMocks({ completedGeneration: 2 });
    const service = createService(mocks.prisma, mocks.sync);

    await service.processDueRequests();

    expect(mocks.transaction.repositorySyncRequest.delete).not.toHaveBeenCalled();
    expect(mocks.transaction.repositorySyncRequest.update).toHaveBeenCalledWith({
      data: expect.objectContaining({ attempt: 0, status: 'PENDING' }),
      where: { id: mocks.candidate.id },
    });
  });

  it('defers the repository and provider account to a supplied rate-limit reset', async () => {
    const retryAt = new Date(Date.now() + 10 * 60_000);
    const error = new ProviderRequestError('GitHub', 429, retryAt);
    const mocks = processingMocks({ error });
    const service = createService(mocks.prisma, mocks.sync);

    await service.processDueRequests();

    expect(mocks.transaction.repositorySyncRequest.update).toHaveBeenCalledWith({
      data: expect.objectContaining({ runAfter: retryAt, status: 'PENDING' }),
      where: { id: mocks.candidate.id },
    });
    expect(mocks.transaction.providerAccount.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rateLimitResetAt: retryAt }) }),
    );
  });

  it('enqueues only idle or failed repositories for a manual run-all request', async () => {
    const repository = { id: '00000000-0000-0000-0000-000000000001' };
    const service = createService({
      repository: {
        findFirst: jest.fn().mockResolvedValue({ ...repository, syncRequest: null }),
        findMany: jest.fn().mockResolvedValue([repository]),
      },
      repositorySyncRequest: { create: jest.fn().mockResolvedValue(undefined) },
    });

    await expect(service.enqueueAvailableRepositories()).resolves.toBe(1);
  });

  it('does not enqueue a repository that is already waiting or running', async () => {
    const service = createService({
      repository: {
        findFirst: jest.fn().mockResolvedValue({ id: 'repository-id', syncRequest: { status: 'RUNNING' } }),
      },
    });

    await expect(service.enqueueRepositorySyncIfAvailable('repository-id')).resolves.toBe(false);
  });

  it('persists progress only for the active request lease', async () => {
    const mocks = processingMocks();
    mocks.sync.syncRepositoryById.mockImplementation(async (_repositoryId, _scopes, reportProgress) => {
      await reportProgress({ current: 2, phase: 'SYNCING_ISSUES', total: 5 });
      return true;
    });
    const service = createService(mocks.prisma, mocks.sync);

    await service.processDueRequests();

    expect(mocks.prisma.repositorySyncRequest.updateMany).toHaveBeenCalledWith({
      data: { progressCurrent: 2, progressPhase: 'SYNCING_ISSUES', progressTotal: 5 },
      where: { id: mocks.candidate.id, leaseToken: expect.any(String), status: 'RUNNING' },
    });
  });
});

function createService(prisma: object, sync: object = { syncRepositoryById: jest.fn() }): ProviderSyncQueueService {
  return new ProviderSyncQueueService(
    prisma as PrismaService,
    { run: jest.fn((_name, callback) => callback()) } as unknown as JobRunnerService,
    sync as ProviderSyncService,
  );
}

function processingMocks(options: { completedGeneration?: number; error?: Error } = {}) {
  const candidate = {
    attempt: 0,
    createdAt: new Date(),
    generation: 1,
    id: '00000000-0000-0000-0000-000000000002',
    lastError: null,
    leaseExpiresAt: null,
    leaseToken: null,
    repository: { providerAccountId: '00000000-0000-0000-0000-000000000003' },
    repositoryId: '00000000-0000-0000-0000-000000000001',
    requestedAt: new Date(),
    runAfter: new Date(),
    status: 'PENDING',
    updatedAt: new Date(),
  } as const;
  let leaseToken: string | null = null;
  const transaction = {
    providerAccount: {
      updateMany: jest.fn(({ data }) => {
        if (data.syncLeaseToken) leaseToken = data.syncLeaseToken;
        return Promise.resolve({ count: 1 });
      }),
    },
    repositorySyncRequest: {
      delete: jest.fn().mockResolvedValue(undefined),
      findUnique: jest.fn(() =>
        Promise.resolve({
          ...candidate,
          generation: options.completedGeneration ?? candidate.generation,
          leaseToken,
        }),
      ),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    repositorySyncRequest: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValueOnce([candidate]).mockResolvedValueOnce([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    transaction: jest.fn((callback) => callback(transaction)),
  };
  const sync = {
    syncRepositoryById: options.error ? jest.fn().mockRejectedValue(options.error) : jest.fn().mockResolvedValue(true),
  };
  return { candidate, prisma, sync, transaction };
}
