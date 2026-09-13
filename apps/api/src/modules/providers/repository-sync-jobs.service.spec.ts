import type { PrismaService } from '../../prisma/prisma.service.js';
import type { RepositoriesQueryService } from '../repositories/repositories-query.service.js';
import { RepositorySyncJobsService } from './repository-sync-jobs.service.js';
import type { ProviderSyncQueueService } from './sync-queue.service.js';

describe('RepositorySyncJobsService', () => {
  const user = { id: 'viewer', role: 'VIEWER' as const, username: 'viewer' };

  it('returns idle repositories as permanently available jobs', async () => {
    const prisma = {
      repository: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'repository-id',
            name: 'ezrepo',
            owner: 'tobiaswaelde',
            providerAccount: { displayName: 'GitHub', providerType: 'GITHUB' },
            syncRequest: null,
          },
        ]),
      },
    };
    const repositories = {
      getReadAbility: jest.fn().mockResolvedValue({}),
      visibleWhere: jest.fn().mockReturnValue({ id: { in: ['repository-id'] } }),
    };
    const service = createService(prisma, repositories);

    await expect(service.query(user, { page: 1, perPage: 10 } as never)).resolves.toMatchObject({
      items: [
        {
          id: 'repository-id',
          scopes: ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS'],
          status: 'IDLE',
        },
      ],
      meta: { itemCount: 1 },
    });
    expect(repositories.visibleWhere).toHaveBeenCalled();
  });

  it('derives summary counts from the permission-scoped repository set', async () => {
    const prisma = {
      repository: {
        count: jest
          .fn()
          .mockResolvedValueOnce(5)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(1),
      },
    };
    const service = createService(prisma);

    await expect(service.summary(user)).resolves.toEqual({ failed: 1, idle: 1, pending: 1, running: 2, total: 5 });
  });

  it('starts only available repository jobs', async () => {
    const prisma = { repository: { findFirst: jest.fn().mockResolvedValue({ id: 'repository-id' }) } };
    const queue = { enqueueRepositorySyncIfAvailable: jest.fn().mockResolvedValue(false) };
    const service = createService(prisma, undefined, queue);

    await expect(service.start('repository-id')).resolves.toBe(0);
  });
});

function createService(prisma: object, repositories?: object, queue?: object): RepositorySyncJobsService {
  return new RepositorySyncJobsService(
    prisma as PrismaService,
    (repositories ?? {
      getReadAbility: jest.fn().mockResolvedValue({}),
      visibleWhere: jest.fn().mockReturnValue({ id: { in: ['repository-id'] } }),
    }) as RepositoriesQueryService,
    (queue ?? {}) as ProviderSyncQueueService,
  );
}
