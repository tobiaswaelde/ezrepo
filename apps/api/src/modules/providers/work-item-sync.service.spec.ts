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

  it('reconciles branch-scoped runs with the pull request active at each run timestamp', async () => {
    const oldRunAt = new Date('2026-08-05T10:00:00.000Z');
    const oldSuccessAt = new Date('2026-08-06T10:00:00.000Z');
    const newRunAt = new Date('2026-09-05T10:00:00.000Z');
    const prisma = {
      pullRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            closedAt: null,
            id: 'new-pull-request',
            mergedAt: null,
            number: '20',
            providerCreatedAt: new Date('2026-09-01T00:00:00.000Z'),
            sourceBranch: 'feature/reused',
            state: 'OPEN',
            targetBranch: 'main',
          },
          {
            closedAt: new Date('2026-08-10T00:00:00.000Z'),
            id: 'old-pull-request',
            mergedAt: new Date('2026-08-10T00:00:00.000Z'),
            number: '10',
            providerCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
            sourceBranch: 'feature/reused',
            state: 'MERGED',
            targetBranch: 'main',
          },
        ]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      workflowRun: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { headBranch: 'feature/reused', id: 'old-failure', providerCreatedAt: oldRunAt },
            { headBranch: 'feature/reused', id: 'old-success', providerCreatedAt: oldSuccessAt },
            {
              headBranch: 'feature/reused',
              id: 'before-first-pull-request',
              providerCreatedAt: new Date('2026-07-01T00:00:00.000Z'),
            },
            { headBranch: 'feature/reused', id: 'new-failure', providerCreatedAt: newRunAt },
            { headBranch: 'main', id: 'main-failure', providerCreatedAt: newRunAt },
          ])
          .mockResolvedValue([{ awaitingApproval: false, status: 'FAILED' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new WorkItemSyncService(prisma as unknown as PrismaService, notifications as never);

    await service.reconcileWorkflowRunChangeRequests('repository');

    expect(prisma.pullRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { repositoryId: 'repository', sourceBranch: { in: ['feature/reused', 'main'] } },
      }),
    );
    expect(prisma.workflowRun.updateMany).toHaveBeenNthCalledWith(1, {
      data: {
        changeRequestCheckedAt: expect.any(Date),
        changeRequestMergedAt: null,
        changeRequestNumber: '20',
        changeRequestState: 'OPEN',
        changeRequestTargetBranch: 'main',
        pullRequestId: 'new-pull-request',
        scopeKey: 'change-request:20',
      },
      where: { id: { in: ['new-failure'] } },
    });
    expect(prisma.workflowRun.updateMany).toHaveBeenNthCalledWith(2, {
      data: {
        changeRequestCheckedAt: expect.any(Date),
        changeRequestMergedAt: new Date('2026-08-10T00:00:00.000Z'),
        changeRequestNumber: '10',
        changeRequestState: 'MERGED',
        changeRequestTargetBranch: 'main',
        pullRequestId: 'old-pull-request',
        scopeKey: 'change-request:10',
      },
      where: { id: { in: ['old-failure', 'old-success'] } },
    });
    expect(prisma.workflowRun.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.pullRequest.update).toHaveBeenCalledTimes(2);
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
