import { BadRequestException, Injectable } from '@nestjs/common';
import type { QueryOptionsMap } from '@querry-kit/nest';

import { CaslAction } from '../../casl/casl-action.js';
import { accessibleBy } from '../../casl/casl-prisma.js';
import { CaslSubject } from '../../casl/casl-subject.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { WorkflowRunsQueryService, type WorkflowRunTypeMap } from '../workflow-runs/workflow-runs-query.service.js';
import type {
  DashboardSecurityAlertSummaryDto,
  DashboardStatusDistributionDto,
  DashboardSummaryDto,
} from './dto/dashboard-summary.dto.js';
import type { DashboardWorkflowRunModel } from './dto/dashboard-workflow-run.dto.js';
import type { RepositoryHealthDto } from './dto/repository-health.dto.js';
import type {
  DashboardPeriodQueryDto,
  TrendBucketSize,
  WorkflowRunTrendQueryDto,
} from './dto/workflow-run-trend.dto.js';

const dashboardRunInclude = {
  repository: {
    select: {
      id: true,
      name: true,
      owner: true,
      providerAccount: { select: { displayName: true, id: true, providerType: true } },
      url: true,
    },
  },
} satisfies Prisma.WorkflowRunInclude;
const dashboardSummarySelect = {
  awaitingApproval: true,
  durationMs: true,
  status: true,
} satisfies Prisma.WorkflowRunSelect;
const repositoryHealthSelect = {
  durationMs: true,
  repository: { select: { id: true, name: true, owner: true, url: true } },
  status: true,
} satisfies Prisma.WorkflowRunSelect;
const completedDashboardStatuses = ['SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED', 'UNKNOWN'] as const;
const repositoryHealthLimit = 6;

type DashboardSummaryRun = Prisma.WorkflowRunGetPayload<{ select: typeof dashboardSummarySelect }>;
type RepositoryHealthRun = Prisma.WorkflowRunGetPayload<{ select: typeof repositoryHealthSelect }>;

/** Success and error counts for a UTC workflow-run trend interval. */
export interface WorkflowRunTrendBucket {
  bucketStart: Date;
  errorCount: number;
  successCount: number;
}

/** Reads dashboard aggregates from only the workflow runs visible to the authenticated user. */
@Injectable()
export class DashboardService {
  /**
   * Initialize DashboardService with its required dependencies.
   *
   * @param workflowRuns - Ability-aware workflow-run query service.
   * @param prisma - Database client used for persisted application state.
   */
  constructor(
    private readonly workflowRuns: WorkflowRunsQueryService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Return the 15 newest visible workflow contexts whose latest terminal run failed.
   *
   * @param user - Authenticated user requesting the dashboard.
   * @returns A limited newest-first preview of current terminal failures.
   */
  async getLatestFailures(user: AuthenticatedUser): Promise<DashboardWorkflowRunModel[]> {
    const ability = await this.workflowRuns.getReadAbility(user);
    return this.workflowRuns.findNeedsAttention<DashboardWorkflowRunModel>(
      {
        include: dashboardRunInclude,
        orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
        take: 15,
      },
      ability,
    );
  }

  /**
   * Return every visible workflow run that currently requires provider approval.
   *
   * @param user - Authenticated user requesting the approval queue.
   * @returns Approval-gated workflow runs ordered newest first.
   */
  async getAwaitingApproval(user: AuthenticatedUser): Promise<DashboardWorkflowRunModel[]> {
    const ability = await this.workflowRuns.getReadAbility(user);
    return this.workflowRuns.findCurrent<DashboardWorkflowRunModel>(
      {
        include: dashboardRunInclude,
        orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
        where: { awaitingApproval: true },
      },
      ability,
    );
  }

  /**
   * Return the ten newest workflow runs visible to the user.
   *
   * @param user - Authenticated user requesting the dashboard.
   * @returns The latest visible provider workflow runs.
   */
  async getLatestRuns(user: AuthenticatedUser): Promise<DashboardWorkflowRunModel[]> {
    return this.findVisibleRuns(user, {
      orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
      take: 10,
    });
  }

  /**
   * Summarize visible period metrics and current workflow state.
   *
   * Success rate excludes cancelled, skipped, and unknown outcomes because those runs do not represent a decided
   * result.
   *
   * @param user - Authenticated user requesting the dashboard.
   * @param query - Inclusive period used for completed-run metrics.
   * @returns Permission-aware summary metrics.
   * @throws BadRequestException - The dashboard start timestamp must not be after the end timestamp.
   */
  async getSummary(user: AuthenticatedUser, query: DashboardPeriodQueryDto): Promise<DashboardSummaryDto> {
    const { from, to } = this.parsePeriod(query);
    const ability = await this.workflowRuns.getReadAbility(user);
    const visibleRunWhere = accessibleBy(ability, CaslAction.Read).ofType(
      CaslSubject.WorkflowRun as never,
    ) as Prisma.WorkflowRunWhereInput;
    const visibleRepositoryWhere = accessibleBy(ability, CaslAction.Read).ofType(
      CaslSubject.Repository as never,
    ) as Prisma.RepositoryWhereInput;
    const [completedRuns, activeRuns, currentDuration, retainedDuration, securityAlerts] = await Promise.all([
      this.workflowRuns.findMany<DashboardSummaryRun>(
        {
          select: dashboardSummarySelect,
          where: {
            completedAt: { gte: from.toISOString(), lte: to.toISOString() },
            status: { in: [...completedDashboardStatuses] },
          },
        },
        ability,
      ),
      this.workflowRuns.findCurrent<DashboardSummaryRun>(
        { select: dashboardSummarySelect, where: { status: { in: ['QUEUED', 'RUNNING'] } } },
        ability,
      ),
      this.prisma.workflowRun.aggregate({ _sum: { durationMs: true }, where: visibleRunWhere }),
      this.prisma.repository.aggregate({ _sum: { retainedRunDurationMs: true }, where: visibleRepositoryWhere }),
      this.getSecurityAlertSummary(user),
    ]);
    const statuses = this.countStatuses(completedRuns);
    const decidedCount = statuses.success + statuses.failed;

    return {
      awaitingApprovalCount: activeRuns.filter((run) => run.awaitingApproval).length,
      completedCount: completedRuns.length,
      medianDurationMs: this.median(completedRuns.flatMap((run) => (run.durationMs === null ? [] : [run.durationMs]))),
      queuedCount: activeRuns.filter((run) => run.status === 'QUEUED').length,
      runningCount: activeRuns.filter((run) => run.status === 'RUNNING').length,
      statuses,
      ...(securityAlerts ? { securityAlerts } : {}),
      successRate: decidedCount === 0 ? 0 : this.roundPercentage((statuses.success / decidedCount) * 100),
      totalRunDurationMs:
        Number(currentDuration._sum.durationMs ?? 0) + Number(retainedDuration._sum.retainedRunDurationMs ?? 0n),
    };
  }

  /**
   * Return open alert counters only for managers and system administrators.
   *
   * @param user - Authenticated dashboard caller.
   * @returns Permission-scoped alert counters, or null for viewers.
   */
  private async getSecurityAlertSummary(user: AuthenticatedUser): Promise<DashboardSecurityAlertSummaryDto | null> {
    if (user.role === 'VIEWER') return null;
    const repositoryIds =
      user.role === 'SYSTEM_ADMIN'
        ? undefined
        : (
            await this.prisma.repositoryMembership.findMany({
              select: { repositoryId: true },
              where: { role: 'MANAGER', userId: user.id },
            })
          ).map(({ repositoryId }) => repositoryId);
    const where: Prisma.SecurityAlertWhereInput = {
      state: 'OPEN',
      ...(repositoryIds === undefined ? {} : { repositoryId: { in: repositoryIds } }),
    };
    const [kinds, severities] = await Promise.all([
      this.prisma.securityAlert.groupBy({ by: ['kind'], _count: true, where }),
      this.prisma.securityAlert.groupBy({ by: ['severity'], _count: true, where }),
    ]);
    const kind = new Map(kinds.map((entry) => [entry.kind, entry._count]));
    const severity = new Map(severities.map((entry) => [entry.severity, entry._count]));
    return {
      code: kind.get('CODE') ?? 0,
      critical: severity.get('CRITICAL') ?? 0,
      dependency: kind.get('DEPENDENCY') ?? 0,
      high: severity.get('HIGH') ?? 0,
      info: severity.get('INFO') ?? 0,
      low: severity.get('LOW') ?? 0,
      medium: severity.get('MEDIUM') ?? 0,
      secret: kind.get('SECRET') ?? 0,
      unknown: severity.get('UNKNOWN') ?? 0,
    };
  }

  /**
   * Aggregate and rank visible repository workflow health for one period.
   *
   * @param user - Authenticated user requesting the dashboard.
   * @param query - Inclusive period used for completed-run metrics.
   * @returns Up to six visible repositories ordered by failures and success rate.
   * @throws BadRequestException - The dashboard start timestamp must not be after the end timestamp.
   */
  async getRepositoryHealth(user: AuthenticatedUser, query: DashboardPeriodQueryDto): Promise<RepositoryHealthDto[]> {
    const { from, to } = this.parsePeriod(query);
    const ability = await this.workflowRuns.getReadAbility(user);
    const runs = await this.workflowRuns.findMany<RepositoryHealthRun>(
      {
        select: repositoryHealthSelect,
        where: {
          completedAt: { gte: from.toISOString(), lte: to.toISOString() },
          status: { in: [...completedDashboardStatuses] },
        },
      },
      ability,
    );
    const groups = new Map<string, RepositoryHealthRun[]>();
    for (const run of runs) {
      const group = groups.get(run.repository.id) ?? [];
      group.push(run);
      groups.set(run.repository.id, group);
    }

    return [...groups.values()]
      .map((repositoryRuns): RepositoryHealthDto => {
        const statuses = this.countStatuses(repositoryRuns);
        const decidedCount = statuses.success + statuses.failed;
        return {
          completedCount: repositoryRuns.length,
          failedCount: statuses.failed,
          medianDurationMs: this.median(
            repositoryRuns.flatMap((run) => (run.durationMs === null ? [] : [run.durationMs])),
          ),
          repository: repositoryRuns[0]!.repository,
          successRate: decidedCount === 0 ? 0 : this.roundPercentage((statuses.success / decidedCount) * 100),
        };
      })
      .sort(
        (left, right) =>
          right.failedCount - left.failedCount ||
          left.successRate - right.successRate ||
          right.completedCount - left.completedCount ||
          `${left.repository.owner}/${left.repository.name}`.localeCompare(
            `${right.repository.owner}/${right.repository.name}`,
          ),
      )
      .slice(0, repositoryHealthLimit);
  }

  /**
   * Aggregate visible completed runs into UTC success and error trend buckets.
   *
   * @param user - Authenticated user requesting the dashboard.
   * @param query - Inclusive time range and bucket size.
   * @returns A continuous sequence of trend buckets, including empty intervals.
   * @throws BadRequestException - When the requested range is invalid.
   */
  async getTrend(user: AuthenticatedUser, query: WorkflowRunTrendQueryDto): Promise<WorkflowRunTrendBucket[]> {
    const { from, to } = this.parsePeriod(query);

    const runs = await this.findVisibleRuns(user, {
      where: {
        completedAt: { gte: from.toISOString(), lte: to.toISOString() },
        status: { in: ['SUCCESS', 'FAILED'] },
      },
    });
    const buckets = this.createBuckets(from, to, query.bucket);
    const counts = new Map(buckets.map((bucket) => [bucket.bucketStart.toISOString(), bucket]));

    for (const run of runs) {
      if (!run.completedAt) continue;
      const bucket = counts.get(this.floorBucket(run.completedAt, query.bucket).toISOString());
      if (!bucket) continue;
      if (run.status === 'SUCCESS') bucket.successCount += 1;
      if (run.status === 'FAILED') bucket.errorCount += 1;
    }

    return buckets;
  }

  /**
   * Create empty UTC trend buckets spanning the requested period.
   *
   * @param from - Inclusive start of the requested time range.
   * @param to - Inclusive end of the requested time range.
   * @param size - UTC hour, day, or week interval used for trend buckets.
   * @returns Chronologically ordered UTC buckets with zero initial counts.
   */
  private createBuckets(from: Date, to: Date, size: TrendBucketSize): WorkflowRunTrendBucket[] {
    const buckets: WorkflowRunTrendBucket[] = [];
    for (
      let bucketStart = this.floorBucket(from, size);
      bucketStart <= to;
      bucketStart = this.nextBucket(bucketStart, size)
    ) {
      buckets.push({ bucketStart, errorCount: 0, successCount: 0 });
    }
    return buckets;
  }

  /**
   * Load workflow runs with repository access restrictions and dashboard relations.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @param options - Query options applied within the resource visibility restriction.
   * @returns Visible workflow runs with the dashboard relations loaded.
   */
  private async findVisibleRuns(
    user: AuthenticatedUser,
    options: QueryOptionsMap<WorkflowRunTypeMap>['findMany'],
  ): Promise<DashboardWorkflowRunModel[]> {
    const ability = await this.workflowRuns.getReadAbility(user);
    return this.workflowRuns.findMany<DashboardWorkflowRunModel>({ ...options, include: dashboardRunInclude }, ability);
  }

  /**
   * Count terminal workflow outcomes for the dashboard status distribution.
   *
   * @param runs - Workflow runs to aggregate, associate, or persist.
   * @returns Counts for each terminal workflow status.
   */
  private countStatuses(runs: Pick<DashboardSummaryRun, 'status'>[]): DashboardStatusDistributionDto {
    return {
      cancelled: runs.filter((run) => run.status === 'CANCELLED').length,
      failed: runs.filter((run) => run.status === 'FAILED').length,
      skipped: runs.filter((run) => run.status === 'SKIPPED').length,
      success: runs.filter((run) => run.status === 'SUCCESS').length,
      unknown: runs.filter((run) => run.status === 'UNKNOWN').length,
    };
  }

  /**
   * Calculate the median of numeric values without mutating the input.
   *
   * @param values - Values used for the calculation or stable filter ordering.
   * @returns The middle value or rounded average of the middle pair, or null for an empty input.
   */
  private median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
  }

  /**
   * Parse and validate the requested dashboard time range.
   *
   * @param query - Validated filters, sorting, pagination, or time-range options.
   * @returns Validated start and end timestamps.
   * @throws BadRequestException - The dashboard start timestamp must not be after the end timestamp.
   */
  private parsePeriod(query: DashboardPeriodQueryDto): { from: Date; to: Date } {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new BadRequestException('The dashboard start timestamp must not be after the end timestamp.');
    }
    return { from, to };
  }

  /**
   * Round a percentage to the dashboard display precision.
   *
   * @param value - Value to parse, validate, or normalize.
   * @returns The percentage rounded to one decimal place.
   */
  private roundPercentage(value: number): number {
    return Math.round(value * 10) / 10;
  }

  /**
   * Align a timestamp with the start of its UTC hour, day, or week.
   *
   * @param value - Value to parse, validate, or normalize.
   * @param size - UTC hour, day, or week interval used for trend buckets.
   * @returns The UTC start timestamp of the containing bucket.
   */
  private floorBucket(value: Date, size: TrendBucketSize): Date {
    const date = new Date(value);
    date.setUTCMinutes(0, 0, 0);
    if (size === 'hour') return date;

    date.setUTCHours(0);
    if (size === 'day') return date;

    const day = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
    return date;
  }

  /**
   * Advance a UTC bucket boundary by one requested interval.
   *
   * @param value - Value to parse, validate, or normalize.
   * @param size - UTC hour, day, or week interval used for trend buckets.
   * @returns The UTC start timestamp of the following bucket.
   */
  private nextBucket(value: Date, size: TrendBucketSize): Date {
    const next = new Date(value);
    if (size === 'hour') next.setUTCHours(next.getUTCHours() + 1);
    if (size === 'day') next.setUTCDate(next.getUTCDate() + 1);
    if (size === 'week') next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
}
