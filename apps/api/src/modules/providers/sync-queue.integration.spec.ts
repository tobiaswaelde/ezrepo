import type { JobRunnerService } from '../../jobs/job-runner.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TestDatabaseService } from '../../prisma/test-database.service.js';
import { ProviderRequestError } from './provider-request.error.js';
import { ProviderSyncQueueService } from './sync-queue.service.js';
import type { ProviderSyncService } from './sync.service.js';

describe('provider sync queue integration', () => {
  const prisma = new PrismaService();
  const database = new TestDatabaseService(prisma);

  beforeAll(async () => prisma.onModuleInit());
  beforeEach(async () => database.cleanup());
  afterAll(async () => prisma.onModuleDestroy());

  it('coalesces webhook deliveries for one repository with a trailing debounce', async () => {
    const { account, repository } = await createRepository(prisma);
    const service = createService(prisma, { syncRepositoryById: jest.fn() });

    await service.enqueueWebhookRepository(account.id, repository.providerRepositoryId);
    await service.enqueueWebhookRepository(account.id, repository.providerRepositoryId);

    const request = await prisma.repositorySyncRequest.findUniqueOrThrow({ where: { repositoryId: repository.id } });
    expect(request.generation).toBe(2);
    expect(request.runAfter.getTime() - request.requestedAt.getTime()).toBe(15_000);
    expect(request.status).toBe('PENDING');
  });

  it('allows concurrent workers to execute a repository request only once', async () => {
    const { repository } = await createRepository(prisma);
    let releaseSync: (() => void) | undefined;
    const syncStarted = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    const sync = {
      syncRepositoryById: jest.fn(async () => {
        await syncStarted;
        return true;
      }),
    };
    const firstWorker = createService(prisma, sync);
    const secondWorker = createService(prisma, sync);
    await firstWorker.enqueueEnabledRepositories();

    const processing = Promise.all([firstWorker.processDueRequests(), secondWorker.processDueRequests()]);
    await new Promise((resolve) => setImmediate(resolve));
    releaseSync?.();
    await processing;

    expect(sync.syncRepositoryById).toHaveBeenCalledTimes(1);
    expect(sync.syncRepositoryById).toHaveBeenCalledWith(
      repository.id,
      ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS'],
      expect.any(Function),
    );
    await expect(prisma.repositorySyncRequest.count()).resolves.toBe(0);
  });

  it('serializes different repository synchronizations for the same provider account', async () => {
    const { account } = await createRepository(prisma);
    await prisma.repository.create({
      data: {
        name: 'second',
        owner: 'octo',
        providerAccountId: account.id,
        providerRepositoryId: '43',
        url: 'https://github.example.test/octo/second',
      },
    });
    let activeSyncs = 0;
    let maximumActiveSyncs = 0;
    const sync = {
      syncRepositoryById: jest.fn(async () => {
        activeSyncs += 1;
        maximumActiveSyncs = Math.max(maximumActiveSyncs, activeSyncs);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeSyncs -= 1;
        return true;
      }),
    };
    const firstWorker = createService(prisma, sync);
    const secondWorker = createService(prisma, sync);
    await firstWorker.enqueueEnabledRepositories();

    await Promise.all([firstWorker.processDueRequests(), secondWorker.processDueRequests()]);

    expect(sync.syncRepositoryById).toHaveBeenCalledTimes(2);
    expect(maximumActiveSyncs).toBe(1);
  });

  it('persists a provider-wide rate-limit delay for subsequent workers', async () => {
    const { account, repository } = await createRepository(prisma);
    const retryAt = new Date(Date.now() + 10 * 60_000);
    const service = createService(prisma, {
      syncRepositoryById: jest.fn().mockRejectedValue(new ProviderRequestError('GitHub', 429, retryAt)),
    });
    await service.enqueueEnabledRepositories();

    await service.processDueRequests();

    await expect(
      prisma.repositorySyncRequest.findUnique({ where: { repositoryId: repository.id } }),
    ).resolves.toMatchObject({
      attempt: 1,
      runAfter: retryAt,
      status: 'PENDING',
    });
    await expect(prisma.providerAccount.findUnique({ where: { id: account.id } })).resolves.toMatchObject({
      rateLimitResetAt: retryAt,
      syncLeaseExpiresAt: null,
      syncLeaseToken: null,
    });
  });

  it('reactivates a permanently failed request when a new webhook arrives', async () => {
    const { account, repository } = await createRepository(prisma);
    const service = createService(prisma, {
      syncRepositoryById: jest.fn().mockRejectedValue(new ProviderRequestError('GitHub', 401, null)),
    });
    await service.enqueueEnabledRepositories();
    await service.processDueRequests();

    await expect(
      prisma.repositorySyncRequest.findUnique({ where: { repositoryId: repository.id } }),
    ).resolves.toMatchObject({
      attempt: 1,
      generation: 1,
      status: 'FAILED',
    });

    await service.enqueueWebhookRepository(account.id, repository.providerRepositoryId);

    await expect(
      prisma.repositorySyncRequest.findUnique({ where: { repositoryId: repository.id } }),
    ).resolves.toMatchObject({
      attempt: 0,
      generation: 2,
      lastError: null,
      status: 'PENDING',
    });
  });

  it('enqueues each available repository once across repeated run-all requests', async () => {
    const { repository } = await createRepository(prisma);
    const service = createService(prisma, { syncRepositoryById: jest.fn() });

    await expect(service.enqueueAvailableRepositories()).resolves.toBe(1);
    await expect(service.enqueueAvailableRepositories()).resolves.toBe(0);
    await expect(prisma.repositorySyncRequest.count({ where: { repositoryId: repository.id } })).resolves.toBe(1);
  });

  it('persists reported progress and returns successful jobs to idle', async () => {
    const { repository } = await createRepository(prisma);
    const sync = {
      syncRepositoryById: jest.fn(async (_repositoryId, _scopes, reportProgress) => {
        await reportProgress({ current: 2, phase: 'SYNCING_ISSUES', total: 5 });
        await expect(
          prisma.repositorySyncRequest.findUnique({ where: { repositoryId: repository.id } }),
        ).resolves.toMatchObject({ progressCurrent: 2, progressPhase: 'SYNCING_ISSUES', progressTotal: 5 });
        return true;
      }),
    };
    const service = createService(prisma, sync);
    await service.enqueueAvailableRepositories();

    await service.processDueRequests();

    await expect(
      prisma.repositorySyncRequest.findUnique({ where: { repositoryId: repository.id } }),
    ).resolves.toBeNull();
  });
});

function createService(prisma: PrismaService, sync: object): ProviderSyncQueueService {
  return new ProviderSyncQueueService(
    prisma,
    { run: jest.fn((_name, callback) => callback()) } as unknown as JobRunnerService,
    sync as ProviderSyncService,
  );
}

async function createRepository(prisma: PrismaService) {
  const account = await prisma.providerAccount.create({
    data: {
      displayName: 'Integration account',
      encryptedAccessToken: 'encrypted-token',
      providerType: 'GITHUB',
    },
  });
  const repository = await prisma.repository.create({
    data: {
      name: 'ezrepo',
      owner: 'octo',
      providerAccountId: account.id,
      providerRepositoryId: '42',
      url: 'https://github.example.test/octo/ezrepo',
    },
  });
  return { account, repository };
}
