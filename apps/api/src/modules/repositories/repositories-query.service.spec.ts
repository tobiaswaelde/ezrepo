import { RepositoriesQueryService } from './repositories-query.service.js';

describe('RepositoriesQueryService', () => {
  const ability = {};
  const abilityFactory = { createForUser: jest.fn(() => ability) };
  const prisma = { repository: {}, repositoryMembership: { findMany: jest.fn() } };
  const service = new RepositoriesQueryService(prisma as never, abilityFactory as never);

  beforeEach(() => jest.clearAllMocks());

  it('gives system administrators an unrestricted repository ability', async () => {
    await expect(
      service.getReadAbility({ authProvider: 'LOCAL' as const, id: 'admin', role: 'SYSTEM_ADMIN', username: 'admin' }),
    ).resolves.toBe(ability);
    expect(abilityFactory.createForUser).toHaveBeenCalledWith(
      { authProvider: 'LOCAL' as const, id: 'admin', role: 'SYSTEM_ADMIN', username: 'admin' },
      [],
    );
    expect(prisma.repositoryMembership.findMany).not.toHaveBeenCalled();
  });

  it('builds a repository-scoped ability for non-administrators', async () => {
    const memberships = [{ repositoryId: 'repository-1', role: 'VIEWER' as const }];
    prisma.repositoryMembership.findMany.mockResolvedValue(memberships);

    await expect(
      service.getReadAbility({ authProvider: 'LOCAL' as const, id: 'viewer', role: 'VIEWER', username: 'viewer' }),
    ).resolves.toBe(ability);
    expect(prisma.repositoryMembership.findMany).toHaveBeenCalledWith({
      where: { userId: 'viewer' },
      select: { repositoryId: true, role: true },
    });
    expect(abilityFactory.createForUser).toHaveBeenCalledWith(
      { authProvider: 'LOCAL' as const, id: 'viewer', role: 'VIEWER', username: 'viewer' },
      memberships,
    );
  });

  it('uses a stable repository order when the table has no selected sort', () => {
    expect(service.toQueryOptions({ page: 1, perPage: 10 })).toMatchObject({
      orderBy: [{ owner: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      page: 1,
      perPage: 10,
    });
  });

  it('searches repository identity fields while preserving caller filters', () => {
    expect(service.toQueryOptions({ page: 1, perPage: 10, search: 'ezrepo', where: { enabled: true } })).toMatchObject({
      where: {
        AND: [
          { enabled: true },
          {
            OR: [
              { owner: { contains: 'ezrepo', mode: 'insensitive' } },
              { name: { contains: 'ezrepo', mode: 'insensitive' } },
              { url: { contains: 'ezrepo', mode: 'insensitive' } },
            ],
          },
        ],
      },
    });
  });
});
