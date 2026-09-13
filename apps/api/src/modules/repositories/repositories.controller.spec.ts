import type { PrismaService } from '../../prisma/prisma.service.js';
import type { RepositoryQueryDto } from './dto/repository-query.dto.js';
import type { RepositoryResourceModel } from './dto/resource.dto.js';
import type { RepositoriesQueryService } from './repositories-query.service.js';
import { RepositoriesController } from './repositories.controller.js';
import type { RepositoryConfigurationService } from './repository-configuration.service.js';

describe('RepositoriesController', () => {
  it('loads and projects the workflow-run count required by the administration table', async () => {
    const repository = {
      _count: { workflowRuns: 12 },
      createdAt: new Date('2026-09-09T08:00:00.000Z'),
      enabled: true,
      encryptedWebhookSecret: null,
      id: 'repository-1',
      lastSyncAt: null,
      memberships: [
        {
          user: {
            avatar: { updatedAt: new Date('2026-09-12T10:00:00.000Z') },
            firstName: 'Marie',
            lastName: 'Member',
            username: 'member',
          },
          userId: 'member-1',
        },
      ],
      name: 'ezrepo',
      owner: 'twaelde',
      providerAccountId: 'provider-1',
      providerRepositoryId: '42',
      updatedAt: new Date('2026-09-09T08:00:00.000Z'),
      url: 'https://github.com/tobiaswaelde/ezrepo',
      retainedRunDurationMs: 0n,
      workflowRunRetentionDays: 30,
    } satisfies RepositoryResourceModel;
    const query = {
      fields: 'id,name,members,workflowRunCount',
      page: 1,
      perPage: 10,
    } as RepositoryQueryDto;
    const repositories = {
      getReadAbility: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({
        items: [repository],
        pageMeta: { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 10 },
      }),
      toQueryOptions: jest.fn().mockReturnValue(query),
    };
    const controller = new RepositoriesController(
      {} as PrismaService,
      {} as RepositoryConfigurationService,
      repositories as unknown as RepositoriesQueryService,
    );

    const response = await controller.query({ user: { id: 'admin', role: 'SYSTEM_ADMIN', username: 'admin' } }, query);

    expect(repositories.query).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: { select: { workflowRuns: true } },
          memberships: expect.anything(),
        }),
      }),
      undefined,
    );
    expect(response.items).toEqual([
      {
        id: 'repository-1',
        members: [
          {
            avatarUpdatedAt: new Date('2026-09-12T10:00:00.000Z'),
            firstName: 'Marie',
            lastName: 'Member',
            userId: 'member-1',
            username: 'member',
          },
        ],
        name: 'ezrepo',
        workflowRunCount: 12,
      },
    ]);
  });

  it('loads a repository detail through the permission-aware query service', async () => {
    const ability = undefined;
    const repository = {
      enabled: true,
      id: 'repository-1',
      lastSyncAt: null,
      name: 'ezrepo',
      owner: 'twaelde',
      providerAccountId: 'provider-1',
      providerRepositoryId: '42',
      url: 'https://github.com/tobiaswaelde/ezrepo',
      workflowRunRetentionDays: null,
    } as RepositoryResourceModel;
    const repositories = {
      findById: jest.fn().mockResolvedValue(repository),
      getReadAbility: jest.fn().mockResolvedValue(ability),
    };
    const controller = new RepositoriesController(
      {} as PrismaService,
      {} as RepositoryConfigurationService,
      repositories as unknown as RepositoriesQueryService,
    );
    const viewer = { id: 'viewer', role: 'VIEWER' as const, username: 'viewer' };

    await expect(controller.findById({ user: viewer }, repository.id)).resolves.toMatchObject({
      id: repository.id,
      name: repository.name,
    });
    expect(repositories.getReadAbility).toHaveBeenCalledWith(viewer);
    expect(repositories.findById).toHaveBeenCalledWith(
      repository.id,
      { include: { memberships: expect.anything() } },
      ability,
    );
  });
});
