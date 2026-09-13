import type { PrismaService } from '../../prisma/prisma.service.js';
import type { ProviderAdapter } from './provider-adapter.js';
import { WorkItemSyncService } from './work-item-sync.service.js';

describe('WorkItemSyncService', () => {
  it('advances each cursor only after its complete provider page sequence succeeds', async () => {
    const prisma = {
      workItemSyncCursor: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    };
    const adapter = {
      listIssues: jest.fn().mockResolvedValue([]),
      listPullRequests: jest.fn().mockResolvedValue([]),
    } as unknown as ProviderAdapter;
    const service = new WorkItemSyncService(prisma as unknown as PrismaService);
    await service.synchronize(
      { accessToken: 'token', baseUrl: null, providerAccountId: 'account' },
      { id: 'repository', name: 'ezrepo', owner: 'ezrepo', providerAccountId: 'account', providerRepositoryId: '1' },
      adapter,
    );
    expect(prisma.workItemSyncCursor.upsert).toHaveBeenCalledTimes(2);
    expect(adapter.listIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ includeAllOpen: true, updatedAfter: expect.any(Date) }),
    );
  });

  it('does not advance the issue cursor or begin pull-request sync after an issue fetch fails', async () => {
    const prisma = {
      workItemSyncCursor: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    };
    const adapter = {
      listIssues: jest.fn().mockRejectedValue(new Error('partial pagination failure')),
      listPullRequests: jest.fn(),
    } as unknown as ProviderAdapter;
    const service = new WorkItemSyncService(prisma as unknown as PrismaService);
    await expect(
      service.synchronize(
        { accessToken: 'token', baseUrl: null, providerAccountId: 'account' },
        { id: 'repository', name: 'ezrepo', owner: 'ezrepo', providerAccountId: 'account', providerRepositoryId: '1' },
        adapter,
      ),
    ).rejects.toThrow('partial pagination failure');
    expect(prisma.workItemSyncCursor.upsert).not.toHaveBeenCalled();
    expect(adapter.listPullRequests).not.toHaveBeenCalled();
  });

  it.each([
    [['SUCCESS', 'SKIPPED'], 'SUCCESS'],
    [['SUCCESS', 'QUEUED'], 'PENDING'],
    [['RUNNING', 'SUCCESS'], 'RUNNING'],
    [['FAILED', 'RUNNING'], 'FAILED'],
    [['CANCELLED'], 'CANCELLED'],
    [['CANCELLED', 'SUCCESS'], 'CANCELLED'],
    [['UNKNOWN', 'SUCCESS'], 'SUCCESS'],
    [[], 'UNKNOWN'],
  ] as const)('aggregates current workflow states %j as %s', async (statuses, expected) => {
    const prisma = {
      pullRequest: { update: jest.fn().mockResolvedValue(undefined) },
      workflowRun: {
        findMany: jest.fn().mockResolvedValue(
          statuses.map((status, index) => ({
            awaitingApproval: index === 0 && status === 'QUEUED',
            status,
          })),
        ),
      },
    };
    const service = new WorkItemSyncService(prisma as unknown as PrismaService);
    await service.refreshPullRequestWorkflowStatus('pull-request-id');
    expect(prisma.pullRequest.update).toHaveBeenCalledWith({
      data: { workflowApprovalRequired: String(statuses[0]) === 'QUEUED', workflowStatus: expected },
      where: { id: 'pull-request-id' },
    });
  });
});
