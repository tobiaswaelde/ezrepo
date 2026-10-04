import { CaslAbilityFactory } from '../../casl/casl-ability.factory.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TestDatabaseService } from '../../prisma/test-database.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { DashboardService } from '../dashboard/dashboard.service.js';
import { RepositoriesQueryService } from '../repositories/repositories-query.service.js';
import { WorkflowRunsQueryService } from '../workflow-runs/workflow-runs-query.service.js';
import { McpToolsService } from './mcp-tools.service.js';

/** Verify that MCP reads preserve persisted repository memberships for every supported role. */
describe('MCP tool authorization integration', () => {
  const prisma = new PrismaService();
  const database = new TestDatabaseService(prisma);
  const abilityFactory = new CaslAbilityFactory();
  const repositories = new RepositoriesQueryService(prisma, abilityFactory);
  const workflowRuns = new WorkflowRunsQueryService(prisma, abilityFactory);
  const tools = new McpToolsService(new DashboardService(workflowRuns, prisma), repositories, workflowRuns);
  let users: Record<'admin' | 'manager' | 'viewer', AuthenticatedUser>;
  let visibleRepositoryId: string;

  beforeAll(async () => prisma.onModuleInit());
  beforeEach(async () => {
    await database.cleanup();
    const providerAccount = await prisma.providerAccount.create({
      data: {
        displayName: 'MCP integration provider',
        encryptedAccessToken: 'encrypted-token',
        providerType: 'GITHUB',
      },
    });
    const [visibleRepository] = await Promise.all([
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
    const [admin, manager, viewer] = await Promise.all([
      prisma.user.create({ data: { passwordHash: 'hash', role: 'SYSTEM_ADMIN', username: 'mcp-admin' } }),
      prisma.user.create({ data: { passwordHash: 'hash', role: 'MANAGER', username: 'mcp-manager' } }),
      prisma.user.create({ data: { passwordHash: 'hash', role: 'VIEWER', username: 'mcp-viewer' } }),
    ]);
    await Promise.all([
      prisma.repositoryMembership.create({
        data: { repositoryId: visibleRepository.id, role: 'MANAGER', userId: manager.id },
      }),
      prisma.repositoryMembership.create({
        data: { repositoryId: visibleRepository.id, role: 'VIEWER', userId: viewer.id },
      }),
    ]);
    users = {
      admin: { authProvider: 'LOCAL' as const, id: admin.id, role: admin.role, username: admin.username },
      manager: { authProvider: 'LOCAL' as const, id: manager.id, role: manager.role, username: manager.username },
      viewer: { authProvider: 'LOCAL' as const, id: viewer.id, role: viewer.role, username: viewer.username },
    };
    visibleRepositoryId = visibleRepository.id;
  });
  afterAll(async () => prisma.onModuleDestroy());

  it.each([
    ['admin', 2],
    ['manager', 1],
    ['viewer', 1],
  ] as const)('returns only repositories visible to the %s', async (role, expectedTotal) => {
    const result = await tools.listRepositories(users[role], { limit: 25, page: 1 });

    expect(result.total).toBe(expectedTotal);
    expect(result.items).toHaveLength(expectedTotal);
    if (role !== 'admin') expect(result.items.map(({ id }) => id)).toEqual([visibleRepositoryId]);
  });

  it('resolves current memberships again for every MCP call', async () => {
    await expect(tools.listRepositories(users.viewer, { limit: 25, page: 1 })).resolves.toMatchObject({ total: 1 });
    await prisma.repositoryMembership.deleteMany({ where: { userId: users.viewer.id } });
    await expect(tools.listRepositories(users.viewer, { limit: 25, page: 1 })).resolves.toMatchObject({ total: 0 });
  });
});
