import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
  ApiResourceQuery,
  QueryTransformPipe,
  ResourceQuery,
} from '@querry-kit/nest';

import type { Prisma } from '../../generated/prisma/client.js';
import { Authenticated } from '../auth/authenticated.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { WorkflowRunDto, type WorkflowRunResourceModel } from '../repositories/dto/resource.dto.js';
import { WorkflowRunQueryDto } from './dto/workflow-run-query.dto.js';
import { WorkflowRunsQueryService } from './workflow-runs-query.service.js';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

const workflowRunContextInclude = {
  repository: {
    select: {
      name: true,
      owner: true,
      providerAccount: { select: { providerType: true } },
    },
  },
} satisfies Prisma.WorkflowRunInclude;

/** Provides paginated workflow-run history and needs-attention views for repositories visible to the caller. */
@ApiTags('workflow-runs')
@Authenticated()
@Controller('workflow-runs')
export class WorkflowRunsController {
  /**
   * Initialize WorkflowRunsController with its required dependencies.
   *
   * @param workflowRuns - Ability-aware workflow-run query service.
   */
  constructor(private readonly workflowRuns: WorkflowRunsQueryService) {}

  /**
   * Query visible workflow runs with pagination, filtering, sorting, and workflow-name search.
   *
   * @param request - Authenticated request user.
   * @param query - Query Kit resource query parameters.
   * @returns A projected, paginated workflow-run response.
   */
  @Get()
  @ApiOperation({ summary: 'Query visible workflow runs' })
  @ApiResourceQuery()
  @ApiPaginatedResponse({ description: 'Visible workflow runs.', model: WorkflowRunDto })
  @ApiErrorResponses({ badRequestDescription: 'Invalid workflow-run query.' })
  async query(@Req() request: AuthenticatedRequest, @Query(new QueryTransformPipe()) query: WorkflowRunQueryDto) {
    const ability = await this.workflowRuns.getReadAbility(request.user);
    return ResourceQuery.query({
      ability,
      include: workflowRunContextInclude,
      map: (workflowRun: WorkflowRunResourceModel, currentAbility) =>
        WorkflowRunDto.fromModel(workflowRun, currentAbility),
      query: this.workflowRuns.toQueryOptions(query),
      schema: WorkflowRunDto,
      service: this.workflowRuns,
    });
  }

  /**
   * Query the complete visible set of workflow contexts whose latest terminal run failed.
   *
   * @param request - Authenticated request user.
   * @param query - Query Kit resource query parameters.
   * @returns A projected, paginated needs-attention response.
   */
  @Get('needs-attention')
  @ApiOperation({ summary: 'Query visible workflow runs that need attention' })
  @ApiResourceQuery()
  @ApiPaginatedResponse({ description: 'Visible latest terminal workflow failures.', model: WorkflowRunDto })
  @ApiErrorResponses({ badRequestDescription: 'Invalid needs-attention workflow-run query.' })
  async queryNeedsAttention(
    @Req() request: AuthenticatedRequest,
    @Query(new QueryTransformPipe()) query: WorkflowRunQueryDto,
  ) {
    const ability = await this.workflowRuns.getReadAbility(request.user);
    return ResourceQuery.query({
      ability,
      include: workflowRunContextInclude,
      map: (workflowRun: WorkflowRunResourceModel, currentAbility) =>
        WorkflowRunDto.fromModel(workflowRun, currentAbility),
      query: await this.workflowRuns.toNeedsAttentionQueryOptions(query, ability),
      schema: WorkflowRunDto,
      service: this.workflowRuns,
    });
  }
}
