import { CaslAbilityFactory } from '../../casl/casl-ability.factory.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TestDatabaseService } from '../../prisma/test-database.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { RepositoriesQueryService } from '../repositories/repositories-query.service.js';
import { RepositorySyncJobsService } from './repository-sync-jobs.service.js';

describe('repository synchronization jobs integration', () => {
  const prisma = new PrismaService();
  const database = new TestDatabaseService(prisma);
  const repositories = new RepositoriesQueryService(prisma, new CaslAbilityFactory());
  const jobs = new RepositorySyncJobsService(prisma, repositories, {} as never);
  let users: Record<'admin' | 'viewer' | 'outsider', AuthenticatedUser>;

  beforeAll(async () => prisma.onModuleInit());
  beforeEach(async () => {
    await database.cleanup();
    const providerAccount = await prisma.providerAccount.create({
      data: {
        displayName: 'Integration provider',
        encryptedAccessToken: 'encrypted-token',
        providerType: 'GITHUB',
      },
    });
    const [idleRepository, failedRepository] = await Promise.all([
      prisma.repository.create({
        data: {
          name: 'idle',
          owner: 'ezrepo',
          providerAccountId: providerAccount.id,
          providerRepositoryId: 'idle',
          url: 'https://github.com/ezrepo/idle',
        },
      }),
      prisma.repository.create({
        data: {
          name: 'failed',
          owner: 'ezrepo',
          providerAccountId: providerAccount.id,
          providerRepositoryId: 'failed',
          url: 'https://github.com/ezrepo/failed',
        },
      }),
    ]);
    await prisma.repositorySyncRequest.create({
      data: {
        lastError: 'Provider request failed with status 500.',
        repositoryId: failedRepository.id,
        requestedAt: new Date('2026-09-13T00:00:00.000Z'),
        runAfter: new Date('2026-09-13T00:00:00.000Z'),
        status: 'FAILED',
      },
    });
    const [admin, viewer, outsider] = await Promise.all([
      prisma.user.create({ data: { passwordHash: 'hash', role: 'SYSTEM_ADMIN', username: 'admin' } }),
      prisma.user.create({ data: { passwordHash: 'hash', role: 'VIEWER', username: 'viewer' } }),
      prisma.user.create({ data: { passwordHash: 'hash', role: 'VIEWER', username: 'outsider' } }),
    ]);
    await prisma.repositoryMembership.create({
      data: { repositoryId: idleRepository.id, role: 'VIEWER', userId: viewer.id },
    });
    users = {
      admin: { id: admin.id, role: admin.role, username: admin.username },
      outsider: { id: outsider.id, role: outsider.role, username: outsider.username },
      viewer: { id: viewer.id, role: viewer.role, username: viewer.username },
    };
  });
  afterAll(async () => prisma.onModuleDestroy());

  it.each([
    ['admin', 2, { failed: 1, idle: 1, pending: 0, running: 0, total: 2 }],
    ['viewer', 1, { failed: 0, idle: 1, pending: 0, running: 0, total: 1 }],
    ['outsider', 0, { failed: 0, idle: 0, pending: 0, running: 0, total: 0 }],
  ] as const)('restricts the %s job list and summary to visible repositories', async (role, count, summary) => {
    const result = await jobs.query(users[role], { page: 1, perPage: 10 });

    expect(result.items).toHaveLength(count);
    await expect(jobs.summary(users[role])).resolves.toEqual(summary);
  });

  it('returns only the queue-safe failure message', async () => {
    const result = await jobs.query(users.admin, { page: 1, perPage: 10 });

    expect(result.items.find(({ status }) => status === 'FAILED')?.lastError).toBe(
      'Provider request failed with status 500.',
    );
  });
});
