import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JobRunnerService } from './job-runner.service.js';

export const DEFAULT_WORKFLOW_RUN_RETENTION_DAYS = 90;

/**
 * Calculate the retention cutoff for a global policy or repository override.
 *
 * @param retentionDays - Number of days to retain completed workflow runs.
 * @param now - Reference time for deterministic time-dependent calculations.
 * @returns The earliest completion timestamp still covered by the retention policy.
 * @throws RangeError - When retention days are not a positive integer.
 */
export function getWorkflowRunRetentionCutoff(retentionDays: number, now: Date): Date {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new RangeError('Workflow run retention must be a positive whole number of days.');
  }

  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

/** Deletes completed workflow runs once their effective retention period expires. */
@Injectable()
export class WorkflowRunRetentionService {
  /**
   * Initialize WorkflowRunRetentionService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   * @param jobs - Runner that prevents overlapping background jobs and disables them in tests.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobRunnerService,
  ) {}

  /**
   * Run the cleanup each night when background scheduling is enabled.
   *
   * @returns A promise that resolves when the operation completes.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async scheduleCleanup(): Promise<void> {
    await this.jobs.run('workflow-run-retention', () => this.deleteExpiredRuns());
  }

  /**
   * Delete only completed runs that exceed their global or repository policy.
   *
   * @param now - Reference time for deterministic time-dependent calculations.
   * @returns A promise that resolves when the operation completes.
   */
  async deleteExpiredRuns(now = new Date()): Promise<void> {
    const settings = await this.prisma.applicationSettings.findUnique({ where: { key: 'global' } });
    const defaultRetentionDays = settings?.workflowRunRetentionDays ?? DEFAULT_WORKFLOW_RUN_RETENTION_DAYS;
    const defaultCutoff = getWorkflowRunRetentionCutoff(defaultRetentionDays, now);

    await this.archiveDurationsAndDeleteRuns({
      completedAt: { lt: defaultCutoff },
      repository: { workflowRunRetentionDays: null },
    });

    const repositories = await this.prisma.repository.findMany({
      where: { workflowRunRetentionDays: { not: null } },
      select: { id: true, workflowRunRetentionDays: true },
    });

    for (const repository of repositories) {
      const retentionDays = repository.workflowRunRetentionDays;
      if (retentionDays === null) continue;

      await this.archiveDurationsAndDeleteRuns({
        completedAt: { lt: getWorkflowRunRetentionCutoff(retentionDays, now) },
        repositoryId: repository.id,
      });
    }
  }

  /**
   * Persist deleted run durations by repository before removing the expired records.
   *
   * @param where - Database predicate selecting the workflow runs to archive and remove.
   * @returns A promise that resolves when the operation completes.
   */
  private async archiveDurationsAndDeleteRuns(where: Prisma.WorkflowRunWhereInput): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const durations = await transaction.workflowRun.groupBy({
        by: ['repositoryId'],
        where,
        _sum: { durationMs: true },
      });

      await Promise.all(
        durations.flatMap(({ _sum, repositoryId }) => {
          if (_sum.durationMs === null) return [];
          return [
            transaction.repository.update({
              data: { retainedRunDurationMs: { increment: BigInt(_sum.durationMs) } },
              where: { id: repositoryId },
            }),
          ];
        }),
      );

      await transaction.workflowRun.deleteMany({ where });
    });
  }
}
