import type { PrismaService } from '../prisma/prisma.service.js';
import type { JobRunnerService } from './job-runner.service.js';
import { getWorkflowRunRetentionCutoff, WorkflowRunRetentionService } from './workflow-run-retention.service.js';

function createPrisma() {
  const prisma = {
    applicationSettings: {
      findUnique: jest.fn().mockResolvedValue({
        issueRetentionDays: 30,
        pullRequestRetentionDays: 60,
        workflowRunRetentionDays: 30,
      }),
    },
    issue: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    pullRequest: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    repository: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'run-override', workflowRunRetentionDays: 7 }])
        .mockResolvedValueOnce([{ id: 'issue-override', issueRetentionDays: 14 }])
        .mockResolvedValueOnce([{ id: 'pr-override', pullRequestRetentionDays: 21 }]),
      update: jest.fn(),
    },
    workflowRun: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
  return prisma;
}

describe('record retention', () => {
  it('calculates cutoffs from whole-day retention policies', () => {
    expect(getWorkflowRunRetentionCutoff(7, new Date('2026-08-26T12:00:00.000Z'))).toEqual(
      new Date('2026-08-19T12:00:00.000Z'),
    );
  });

  it('rejects unsafe retention periods', () => {
    expect(() => getWorkflowRunRetentionCutoff(0, new Date())).toThrow(RangeError);
    expect(() => getWorkflowRunRetentionCutoff(1.5, new Date())).toThrow(RangeError);
  });

  it('uses 90-day defaults before global settings exist', async () => {
    const prisma = createPrisma();
    prisma.applicationSettings.findUnique.mockResolvedValue(null);
    prisma.repository.findMany.mockReset().mockResolvedValue([]);

    await new WorkflowRunRetentionService(
      prisma as unknown as PrismaService,
      {} as JobRunnerService,
    ).deleteExpiredRecords(new Date('2026-08-26T12:00:00.000Z'));

    expect(prisma.issue.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ closedAt: { lt: new Date('2026-05-28T12:00:00.000Z') } }),
    });
    expect(prisma.pullRequest.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: [
          { closedAt: { lt: new Date('2026-05-28T12:00:00.000Z') }, state: 'CLOSED' },
          { mergedAt: { lt: new Date('2026-05-28T12:00:00.000Z') }, state: 'MERGED' },
        ],
      }),
    });
  });

  it('applies global defaults and repository overrides only to unreferenced terminal work items', async () => {
    const prisma = createPrisma();
    const now = new Date('2026-08-26T12:00:00.000Z');

    await new WorkflowRunRetentionService(
      prisma as unknown as PrismaService,
      {} as JobRunnerService,
    ).deleteExpiredRecords(now);

    expect(prisma.workflowRun.deleteMany).toHaveBeenNthCalledWith(1, {
      where: {
        completedAt: { lt: new Date('2026-07-27T12:00:00.000Z') },
        repository: { workflowRunRetentionDays: null },
      },
    });
    expect(prisma.workflowRun.deleteMany).toHaveBeenNthCalledWith(2, {
      where: {
        completedAt: { lt: new Date('2026-08-19T12:00:00.000Z') },
        repositoryId: 'run-override',
      },
    });
    expect(prisma.issue.deleteMany).toHaveBeenNthCalledWith(1, {
      where: {
        closedAt: { lt: new Date('2026-07-27T12:00:00.000Z') },
        notificationDeliveries: { none: {} },
        repository: { issueRetentionDays: null },
        state: 'CLOSED',
      },
    });
    expect(prisma.issue.deleteMany).toHaveBeenNthCalledWith(2, {
      where: {
        closedAt: { lt: new Date('2026-08-12T12:00:00.000Z') },
        notificationDeliveries: { none: {} },
        repositoryId: 'issue-override',
        state: 'CLOSED',
      },
    });
    expect(prisma.pullRequest.deleteMany).toHaveBeenNthCalledWith(1, {
      where: {
        notificationDeliveries: { none: {} },
        OR: [
          { closedAt: { lt: new Date('2026-06-27T12:00:00.000Z') }, state: 'CLOSED' },
          { mergedAt: { lt: new Date('2026-06-27T12:00:00.000Z') }, state: 'MERGED' },
        ],
        repository: { pullRequestRetentionDays: null },
        workflowRuns: { none: {} },
      },
    });
    expect(prisma.pullRequest.deleteMany).toHaveBeenNthCalledWith(2, {
      where: {
        notificationDeliveries: { none: {} },
        OR: [
          { closedAt: { lt: new Date('2026-08-05T12:00:00.000Z') }, state: 'CLOSED' },
          { mergedAt: { lt: new Date('2026-08-05T12:00:00.000Z') }, state: 'MERGED' },
        ],
        repositoryId: 'pr-override',
        workflowRuns: { none: {} },
      },
    });
  });

  it('adds expired run durations before deletion and remains safe to rerun', async () => {
    const prisma = createPrisma();
    prisma.repository.findMany.mockReset().mockResolvedValue([]);
    prisma.workflowRun.groupBy.mockResolvedValue([
      { _sum: { durationMs: 120_000 }, repositoryId: 'repository-a' },
      { _sum: { durationMs: null }, repositoryId: 'repository-b' },
    ]);
    const service = new WorkflowRunRetentionService(prisma as unknown as PrismaService, {} as JobRunnerService);
    const now = new Date('2026-08-26T12:00:00.000Z');

    await service.deleteExpiredRecords(now);
    prisma.workflowRun.groupBy.mockResolvedValue([]);
    await service.deleteExpiredRecords(now);

    expect(prisma.repository.update).toHaveBeenCalledTimes(1);
    expect(prisma.repository.update).toHaveBeenCalledWith({
      data: { retainedRunDurationMs: { increment: 120_000n } },
      where: { id: 'repository-a' },
    });
    expect(prisma.issue.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.pullRequest.deleteMany).toHaveBeenCalledTimes(2);
  });
});
