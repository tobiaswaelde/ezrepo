import { CaslAbilityFactory } from '../../casl/casl-ability.factory.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TestDatabaseService } from '../../prisma/test-database.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { RepositoriesQueryService } from './repositories-query.service.js';

/** Verify that repository lists and details cannot expose repositories outside persisted memberships. */
describe('repository authorization integration', () => {
  const prisma = new PrismaService();
  const database = new TestDatabaseService(prisma);
  const repositories = new RepositoriesQueryService(prisma, new CaslAbilityFactory());
  let users: Record<'admin' | 'viewer' | 'outsider', AuthenticatedUser>;
  let visibleRepositoryId: string;
  let hiddenRepositoryId: string;

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
    const [visibleRepository, hiddenRepository] = await Promise.all([
      prisma.repository.create({
        data: {
          name: 'visible',
          owner: 'ezrepo',
          providerAccountId: providerAccount.id,
          providerRepositoryId: 'visible',
          url: 'https://github.com/ezrepo/visible',
        },
      }),
      prisma.repository.create({
        data: {
          name: 'hidden',
          owner: 'ezrepo',
          providerAccountId: providerAccount.id,
          providerRepositoryId: 'hidden',
          url: 'https://github.com/ezrepo/hidden',
        },
      }),
    ]);
    const [admin, viewer, outsider] = await Promise.all([
      prisma.user.create({ data: { passwordHash: 'hash', role: 'SYSTEM_ADMIN', username: 'admin' } }),
      prisma.user.create({ data: { passwordHash: 'hash', role: 'VIEWER', username: 'viewer' } }),
      prisma.user.create({ data: { passwordHash: 'hash', role: 'VIEWER', username: 'outsider' } }),
    ]);
    await prisma.repositoryMembership.create({
      data: { repositoryId: visibleRepository.id, role: 'VIEWER', userId: viewer.id },
    });

    users = {
      admin: { authProvider: 'LOCAL' as const, id: admin.id, role: admin.role, username: admin.username },
      outsider: { authProvider: 'LOCAL' as const, id: outsider.id, role: outsider.role, username: outsider.username },
      viewer: { authProvider: 'LOCAL' as const, id: viewer.id, role: viewer.role, username: viewer.username },
    };
    visibleRepositoryId = visibleRepository.id;
    hiddenRepositoryId = hiddenRepository.id;
  });
  afterAll(async () => prisma.onModuleDestroy());

  it.each([
    ['admin', 2],
    ['viewer', 1],
    ['outsider', 0],
  ] as const)('returns only repositories visible to the %s', async (role, expectedCount) => {
    const ability = await repositories.getReadAbility(users[role]);
    await expect(repositories.findMany({}, ability)).resolves.toHaveLength(expectedCount);
  });

  it('allows an assigned detail while hiding an unassigned repository as not found', async () => {
    const ability = await repositories.getReadAbility(users.viewer);

    await expect(repositories.findById(visibleRepositoryId, {}, ability)).resolves.toMatchObject({
      id: visibleRepositoryId,
    });
    await expect(repositories.findById(hiddenRepositoryId, {}, ability)).rejects.toMatchObject({ status: 404 });
  });
});
