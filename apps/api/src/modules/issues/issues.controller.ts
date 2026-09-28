import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
  ApiResourceQuery,
  QueryTransformPipe,
  ResourceQuery,
} from '@querry-kit/nest';

import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Authenticated } from '../auth/authenticated.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { IssueDto, type IssueResourceModel, IssueSummaryDto, WorkItemFilterOptionsDto } from '../work-items/dto.js';
import { IssueQueryDto } from './dto/issue-query.dto.js';
import { IssuesQueryService } from './issues-query.service.js';

const issueInclude = {
  assignees: { include: { actor: true } },
  author: true,
  labels: { include: { label: true } },
  repository: { select: { name: true, owner: true, providerAccount: { select: { providerType: true } } } },
} satisfies Prisma.IssueInclude;

/** Provides permission-aware issue overview, detail, summary, and filter data. */
@ApiTags('issues')
@Authenticated()
@Controller('issues')
export class IssuesController {
  /**
   * Initialize IssuesController with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   * @param issues - Ability-aware issue query service.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: IssuesQueryService,
  ) {}

  /**
   * Query visible records with filtering, sorting, and pagination.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @param query - Validated filters, sorting, pagination, or time-range options.
   * @returns The visible resource page and its query metadata.
   */
  @Get()
  @ApiOperation({ summary: 'Query visible issues' })
  @ApiResourceQuery()
  @ApiPaginatedResponse({ description: 'Visible provider issues.', model: IssueDto })
  @ApiErrorResponses({ badRequestDescription: 'Invalid issue query.' })
  async query(@Req() request: { user: AuthenticatedUser }, @Query(new QueryTransformPipe()) query: IssueQueryDto) {
    const ability = await this.issues.getReadAbility(request.user);
    return ResourceQuery.query({
      ability,
      include: issueInclude,
      map: (issue: IssueResourceModel) => IssueDto.fromModel(issue, false, ability),
      query: this.issues.toQueryOptions(query),
      schema: IssueDto,
      service: this.issues,
    });
  }

  /**
   * Count the current states of records visible to the authenticated user.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @returns State counts restricted to the resources visible to the caller.
   */
  @Get('summary')
  @ApiOkResponse({ type: IssueSummaryDto })
  async summary(@Req() request: { user: AuthenticatedUser }): Promise<IssueSummaryDto> {
    const ability = await this.issues.getReadAbility(request.user);
    const visible = this.issues.visibleWhere(ability);
    const now = Date.now();
    const [open, recentlyUpdated, assigned, stale] = await Promise.all([
      this.prisma.issue.count({ where: { AND: [visible, { state: 'OPEN' }] } }),
      this.prisma.issue.count({
        where: { AND: [visible, { providerUpdatedAt: { gte: new Date(now - 7 * 24 * 60 * 60 * 1_000) } }] },
      }),
      this.prisma.issue.count({ where: { AND: [visible, { assignees: { some: {} }, state: 'OPEN' }] } }),
      this.prisma.issue.count({
        where: {
          AND: [visible, { providerUpdatedAt: { lt: new Date(now - 30 * 24 * 60 * 60 * 1_000) }, state: 'OPEN' }],
        },
      }),
    ]);
    return { assigned, open, recentlyUpdated, stale };
  }

  /**
   * Return filter choices derived only from work items visible to the authenticated user.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @returns Sorted filter choices from visible work items.
   */
  @Get('filter-options')
  @ApiOkResponse({ type: WorkItemFilterOptionsDto })
  async filterOptions(@Req() request: { user: AuthenticatedUser }): Promise<WorkItemFilterOptionsDto> {
    const ability = await this.issues.getReadAbility(request.user);
    const items = await this.prisma.issue.findMany({
      select: {
        assignees: { select: { actor: { select: { username: true } } } },
        author: { select: { username: true } },
        labels: { select: { label: { select: { name: true, normalizedName: true } } } },
        milestone: true,
      },
      where: this.issues.visibleWhere(ability),
    });
    return this.toFilterOptions(items);
  }

  /**
   * Load one visible resource and map it to its public detail representation.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @param id - Local identifier of the target record.
   * @returns The safe detail DTO for the visible resource.
   * @throws NotFoundException - When the resource is missing or not visible to the authenticated user.
   */
  @Get(':id')
  @ApiOkResponse({ type: IssueDto })
  async findById(@Req() request: { user: AuthenticatedUser }, @Param('id') id: string): Promise<IssueDto> {
    const ability = await this.issues.getReadAbility(request.user);
    return IssueDto.fromModel(
      await this.issues.findById<IssueResourceModel>(id, { include: issueInclude }, ability),
      true,
      ability,
    );
  }

  /**
   * Collect distinct authors, assignees, labels, and milestones for work-item filters.
   *
   * @param items - Records used to build the result.
   * @returns Distinct, sorted filter values.
   */
  private toFilterOptions(
    items: Array<{
      assignees: Array<{ actor: { username: string } }>;
      author: { username: string } | null;
      labels: Array<{ label: { name: string; normalizedName: string } }>;
      milestone: string | null;
    }>,
  ): WorkItemFilterOptionsDto {
    const labels = new Map<string, string>();
    const authors = new Set<string>();
    const assignees = new Set<string>();
    const milestones = new Set<string>();
    for (const item of items) {
      if (item.author) authors.add(item.author.username);
      if (item.milestone) milestones.add(item.milestone);
      for (const { actor } of item.assignees) assignees.add(actor.username);
      for (const { label } of item.labels)
        if (!labels.has(label.normalizedName)) labels.set(label.normalizedName, label.name);
    }
    /**
     * Sort distinct filter values for stable presentation.
     *
     * @param values - Values used for the calculation or stable filter ordering.
     * @returns The supplied values in stable alphabetical order.
     */
    const sort = (values: Iterable<string>) => [...values].sort((left, right) => left.localeCompare(right));
    return {
      assignees: sort(assignees),
      authors: sort(authors),
      labels: sort(labels.values()),
      milestones: sort(milestones),
    };
  }
}
