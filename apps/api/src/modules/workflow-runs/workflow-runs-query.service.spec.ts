import { CaslAbilityFactory } from '../../casl/casl-ability.factory.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { WorkflowRunsQueryService } from './workflow-runs-query.service.js';

describe('WorkflowRunsQueryService', () => {
  it('combines a workflow-name search with repository-scoped CASL access', async () => {
    const mocks = {
      repositoryMembership: {
        findMany: jest.fn().mockResolvedValue([{ repositoryId: 'repository-a', role: 'VIEWER' }]),
      },
      workflowRun: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new WorkflowRunsQueryService(mocks as unknown as PrismaService, new CaslAbilityFactory());
    const ability = await service.getReadAbility({
      authProvider: 'LOCAL' as const,
      id: 'viewer',
      role: 'VIEWER',
      username: 'viewer',
    });

    await service.query(
      service.toQueryOptions({ page: 1, perPage: 20, search: 'deploy', where: { status: 'FAILED' } }),
      ability,
    );

    expect(mocks.repositoryMembership.findMany).toHaveBeenCalledWith({
      select: { repositoryId: true, role: true },
      where: { userId: 'viewer' },
    });
    expect(mocks.workflowRun.count).toHaveBeenCalledWith({
      where: {
        AND: [
          { OR: [{ repositoryId: { in: ['repository-a'] } }] },
          {
            AND: [
              { status: 'FAILED' },
              {
                OR: [
                  { displayTitle: { contains: 'deploy', mode: 'insensitive' } },
                  { providerRunId: { contains: 'deploy', mode: 'insensitive' } },
                  { repository: { name: { contains: 'deploy', mode: 'insensitive' } } },
                  { repository: { owner: { contains: 'deploy', mode: 'insensitive' } } },
                  { workflowName: { contains: 'deploy', mode: 'insensitive' } },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(mocks.workflowRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      }),
    );
  });

  it('uses the requested Query Kit sort order instead of the default', () => {
    const service = new WorkflowRunsQueryService({ workflowRun: {} } as PrismaService, new CaslAbilityFactory());

    expect(service.toQueryOptions({ orderBy: { completedAt: 'asc' }, page: 1, perPage: 10 })).toMatchObject({
      orderBy: { completedAt: 'asc' },
    });
  });

  it('centralizes latest-terminal failure selection before applying public Query Kit filters', async () => {
    const mocks = {
      workflowRun: {
        findMany: jest.fn().mockResolvedValue([
          {
            changeRequestState: 'UNKNOWN',
            id: 'failed-run',
            status: 'FAILED',
          },
          {
            changeRequestState: 'UNKNOWN',
            id: 'successful-run',
            status: 'SUCCESS',
          },
        ]),
      },
    };
    const service = new WorkflowRunsQueryService(mocks as unknown as PrismaService, new CaslAbilityFactory());
    const ability = new CaslAbilityFactory().createForUser(
      { authProvider: 'LOCAL' as const, id: 'admin', role: 'SYSTEM_ADMIN', username: 'admin' },
      [],
    );

    await expect(
      service.toNeedsAttentionQueryOptions(
        { page: 2, perPage: 10, search: 'deploy', where: { repositoryId: 'repository-a' } },
        ability,
      ),
    ).resolves.toMatchObject({
      orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
      page: 2,
      perPage: 10,
      where: {
        AND: [
          { id: { in: ['failed-run'] } },
          {
            AND: [
              { repositoryId: 'repository-a' },
              {
                OR: [
                  { displayTitle: { contains: 'deploy', mode: 'insensitive' } },
                  { providerRunId: { contains: 'deploy', mode: 'insensitive' } },
                  { repository: { name: { contains: 'deploy', mode: 'insensitive' } } },
                  { repository: { owner: { contains: 'deploy', mode: 'insensitive' } } },
                  { workflowName: { contains: 'deploy', mode: 'insensitive' } },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(mocks.workflowRun.findMany).toHaveBeenCalledWith({
      cursor: undefined,
      distinct: ['workflowId', 'scopeKey'],
      include: undefined,
      orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
      select: {
        changeRequestState: true,
        id: true,
        status: true,
      },
      skip: undefined,
      take: undefined,
      where: {
        AND: [
          {},
          {
            awaitingApproval: false,
            completedAt: { not: null },
            status: { in: ['SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED', 'UNKNOWN'] },
            workflow: { kind: 'STANDARD' },
          },
        ],
      },
    });
  });

  it('removes closed and merged change-request failures without hiding active or unknown failures', async () => {
    const mocks = {
      workflowRun: {
        findMany: jest.fn().mockResolvedValue([
          { changeRequestState: 'OPEN', id: 'open-failure', status: 'FAILED' },
          { changeRequestState: 'UNKNOWN', id: 'unknown-failure', status: 'FAILED' },
          { changeRequestState: 'CLOSED', id: 'closed-failure', status: 'FAILED' },
          { changeRequestState: 'MERGED', id: 'merged-failure', status: 'FAILED' },
        ]),
      },
    };
    const service = new WorkflowRunsQueryService(mocks as unknown as PrismaService, new CaslAbilityFactory());
    const ability = new CaslAbilityFactory().createForUser(
      { authProvider: 'LOCAL' as const, id: 'admin', role: 'SYSTEM_ADMIN', username: 'admin' },
      [],
    );

    await expect(service.toNeedsAttentionQueryOptions({ page: 1, perPage: 25 }, ability)).resolves.toMatchObject({
      where: { id: { in: ['open-failure', 'unknown-failure'] } },
    });
    expect(mocks.workflowRun.findMany).toHaveBeenCalledTimes(1);
  });

  it('applies active-state filters only after resolving the latest authorized workflow contexts', async () => {
    const mocks = {
      workflowRun: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'new-success' }, { id: 'current-approval' }])
          .mockResolvedValueOnce([{ id: 'current-approval' }]),
      },
    };
    const service = new WorkflowRunsQueryService(mocks as unknown as PrismaService, new CaslAbilityFactory());
    const ability = new CaslAbilityFactory().createForUser(
      { authProvider: 'LOCAL' as const, id: 'admin', role: 'SYSTEM_ADMIN', username: 'admin' },
      [],
    );

    await expect(
      service.findCurrent<{ id: string }>(
        {
          orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
          where: { awaitingApproval: true },
        },
        ability,
      ),
    ).resolves.toEqual([{ id: 'current-approval' }]);
    expect(mocks.workflowRun.findMany).toHaveBeenNthCalledWith(1, {
      cursor: undefined,
      distinct: ['workflowId', 'scopeKey'],
      include: undefined,
      orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
      skip: undefined,
      take: undefined,
      where: { AND: [{}, {}] },
    });
    expect(mocks.workflowRun.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          AND: [{}, { AND: [{ id: { in: ['new-success', 'current-approval'] } }, { awaitingApproval: true }] }],
        },
      }),
    );
  });
});
