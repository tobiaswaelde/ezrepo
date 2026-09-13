import type { PrismaService } from '../../prisma/prisma.service.js';
import type { ProviderAdapter } from './provider-adapter.js';
import { issueLifecycleEvents, pullRequestLifecycleEvents, WorkItemSyncService } from './work-item-sync.service.js';

describe('WorkItemSyncService', () => {
  const notifications = { emitIssueEvent: jest.fn(), emitPullRequestEvent: jest.fn() };
  it('advances each cursor only after its complete provider page sequence succeeds', async () => {
    const prisma = {
      workItemSyncCursor: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    };
    const adapter = {
      listIssues: jest.fn().mockResolvedValue([]),
      listPullRequests: jest.fn().mockResolvedValue([]),
    } as unknown as ProviderAdapter;
    const service = new WorkItemSyncService(prisma as unknown as PrismaService, notifications as never);
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
    const service = new WorkItemSyncService(prisma as unknown as PrismaService, notifications as never);
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

  it('reports indeterminate provider phases before publishing known item totals', async () => {
    const prisma = {
      workItemSyncCursor: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    };
    const adapter = {
      listIssues: jest.fn().mockResolvedValue([]),
      listPullRequests: jest.fn().mockResolvedValue([]),
    } as unknown as ProviderAdapter;
    const reportProgress = jest.fn().mockResolvedValue(undefined);
    const service = new WorkItemSyncService(prisma as unknown as PrismaService, notifications as never);

    await service.synchronize(
      { accessToken: 'token', baseUrl: null, providerAccountId: 'account' },
      { id: 'repository', name: 'ezrepo', owner: 'ezrepo', providerAccountId: 'account', providerRepositoryId: '1' },
      adapter,
      ['ISSUES', 'PULL_REQUESTS'],
      reportProgress,
    );

    expect(reportProgress.mock.calls).toEqual([
      [{ current: null, phase: 'SYNCING_ISSUES', total: null }],
      [{ current: 0, phase: 'SYNCING_ISSUES', total: 0 }],
      [{ current: null, phase: 'SYNCING_PULL_REQUESTS', total: null }],
      [{ current: 0, phase: 'SYNCING_PULL_REQUESTS', total: 0 }],
    ]);
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
    const service = new WorkItemSyncService(prisma as unknown as PrismaService, notifications as never);
    await service.refreshPullRequestWorkflowStatus('pull-request-id');
    expect(prisma.pullRequest.update).toHaveBeenCalledWith({
      data: { workflowApprovalRequired: String(statuses[0]) === 'QUEUED', workflowStatus: expected },
      where: { id: 'pull-request-id' },
    });
  });
});
it.each([
  [null, 'OPEN', true, ['ISSUE_OPENED']],
  [null, 'CLOSED', true, ['ISSUE_OPENED', 'ISSUE_CLOSED']],
  ['OPEN', 'CLOSED', false, ['ISSUE_CLOSED']],
  ['CLOSED', 'OPEN', false, ['ISSUE_REOPENED']],
  ['OPEN', 'OPEN', false, []],
] as const)('classifies issue lifecycle %s -> %s', (previous, state, createdAfterCursor, expected) => {
  expect(issueLifecycleEvents(previous, state, createdAfterCursor)).toEqual(expected);
});

it.each([
  [null, 'OPEN', true, ['PULL_REQUEST_OPENED']],
  [null, 'CLOSED', true, ['PULL_REQUEST_OPENED', 'PULL_REQUEST_CLOSED']],
  [null, 'MERGED', true, ['PULL_REQUEST_OPENED', 'PULL_REQUEST_MERGED']],
  ['OPEN', 'CLOSED', false, ['PULL_REQUEST_CLOSED']],
  ['OPEN', 'MERGED', false, ['PULL_REQUEST_MERGED']],
  ['CLOSED', 'OPEN', false, ['PULL_REQUEST_REOPENED']],
  ['OPEN', 'OPEN', false, []],
] as const)('classifies pull-request lifecycle %s -> %s', (previous, state, createdAfterCursor, expected) => {
  expect(pullRequestLifecycleEvents(previous, state, createdAfterCursor)).toEqual(expected);
});
