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
import {
  PullRequestDto,
  type PullRequestResourceModel,
  PullRequestSummaryDto,
  WorkItemFilterOptionsDto,
} from '../work-items/dto.js';
import { PullRequestQueryDto } from './dto/pull-request-query.dto.js';
import { PullRequestsQueryService } from './pull-requests-query.service.js';

const pullRequestInclude = {
  assignees: { include: { actor: true } },
  author: true,
  labels: { include: { label: true } },
  repository: { select: { name: true, owner: true, providerAccount: { select: { providerType: true } } } },
} satisfies Prisma.PullRequestInclude;

/** Provides permission-aware pull-request overview, detail, summary, and filter data. */
@ApiTags('pull-requests')
@Authenticated()
@Controller('pull-requests')
export class PullRequestsController {
  /**
   * Initialize PullRequestsController with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   * @param pullRequests - Candidate pull requests ordered newest first for branch and lifetime matching.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly pullRequests: PullRequestsQueryService,
  ) {}

  /**
   * Query visible records with filtering, sorting, and pagination.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @param query - Validated filters, sorting, pagination, or time-range options.
   * @returns The visible resource page and its query metadata.
   */
  @Get()
  @ApiOperation({ summary: 'Query visible pull requests' })
  @ApiResourceQuery()
  @ApiPaginatedResponse({ description: 'Visible provider pull requests.', model: PullRequestDto })
  @ApiErrorResponses({ badRequestDescription: 'Invalid pull-request query.' })
  async query(
    @Req() request: { user: AuthenticatedUser },
    @Query(new QueryTransformPipe()) query: PullRequestQueryDto,
  ) {
    const ability = await this.pullRequests.getReadAbility(request.user);
    return ResourceQuery.query({
      ability,
      include: pullRequestInclude,
      map: (pullRequest: PullRequestResourceModel) => PullRequestDto.fromModel(pullRequest, false, ability),
      query: this.pullRequests.toQueryOptions(query),
      schema: PullRequestDto,
      service: this.pullRequests,
    });
  }

  /**
   * Count the current states of records visible to the authenticated user.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @returns State counts restricted to the resources visible to the caller.
   */
  @Get('summary')
  @ApiOkResponse({ type: PullRequestSummaryDto })
  async summary(@Req() request: { user: AuthenticatedUser }): Promise<PullRequestSummaryDto> {
    const ability = await this.pullRequests.getReadAbility(request.user);
    const visible = this.pullRequests.visibleWhere(ability);
    const [open, drafts, failedWorkflows, workflowApprovalRequired] = await Promise.all([
      this.prisma.pullRequest.count({ where: { AND: [visible, { state: 'OPEN' }] } }),
      this.prisma.pullRequest.count({ where: { AND: [visible, { draft: true, state: 'OPEN' }] } }),
      this.prisma.pullRequest.count({ where: { AND: [visible, { state: 'OPEN', workflowStatus: 'FAILED' }] } }),
      this.prisma.pullRequest.count({ where: { AND: [visible, { state: 'OPEN', workflowApprovalRequired: true }] } }),
    ]);
    return { drafts, failedWorkflows, open, workflowApprovalRequired };
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
    const ability = await this.pullRequests.getReadAbility(request.user);
    const items = await this.prisma.pullRequest.findMany({
      select: {
        assignees: { select: { actor: { select: { username: true } } } },
        author: { select: { username: true } },
        labels: { select: { label: { select: { name: true, normalizedName: true } } } },
      },
      where: this.pullRequests.visibleWhere(ability),
    });
    const labels = new Map<string, string>();
    const authors = new Set<string>();
    const assignees = new Set<string>();
    for (const item of items) {
      if (item.author) authors.add(item.author.username);
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
    return { assignees: sort(assignees), authors: sort(authors), labels: sort(labels.values()), milestones: [] };
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
  @ApiOkResponse({ type: PullRequestDto })
  async findById(@Req() request: { user: AuthenticatedUser }, @Param('id') id: string): Promise<PullRequestDto> {
    const ability = await this.pullRequests.getReadAbility(request.user);
    return PullRequestDto.fromModel(
      await this.pullRequests.findById<PullRequestResourceModel>(id, { include: pullRequestInclude }, ability),
      true,
      ability,
    );
  }
}
