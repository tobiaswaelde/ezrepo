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
  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: IssuesQueryService,
  ) {}

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
    const sort = (values: Iterable<string>) => [...values].sort((left, right) => left.localeCompare(right));
    return {
      assignees: sort(assignees),
      authors: sort(authors),
      labels: sort(labels.values()),
      milestones: sort(milestones),
    };
  }
}
