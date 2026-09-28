import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Authenticated } from '../auth/authenticated.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { DashboardService } from './dashboard.service.js';
import { DashboardSummaryDto } from './dto/dashboard-summary.dto.js';
import { DashboardWorkflowRunDto } from './dto/dashboard-workflow-run.dto.js';
import { RepositoryHealthDto } from './dto/repository-health.dto.js';
import {
  DashboardPeriodQueryDto,
  WorkflowRunTrendBucketDto,
  WorkflowRunTrendQueryDto,
} from './dto/workflow-run-trend.dto.js';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

/** Provides aggregated dashboard information for repositories visible to the caller. */
@ApiTags('dashboard')
@Authenticated()
@Controller('dashboard')
export class DashboardController {
  /**
   * Initialize DashboardController with its required dependencies.
   *
   * @param dashboard - Service for permission-scoped dashboard metrics.
   */
  constructor(private readonly dashboard: DashboardService) {}

  /**
   * List visible runs that are blocked on provider approval.
   *
   * @param request - Authenticated request user.
   * @returns Approval-gated workflow runs ordered newest first.
   */
  @Get('awaiting-approval')
  @ApiOperation({ summary: 'List workflow runs awaiting provider approval' })
  @ApiOkResponse({
    description: 'Visible workflow runs awaiting approval.',
    type: DashboardWorkflowRunDto,
    isArray: true,
  })
  async getAwaitingApproval(@Req() request: AuthenticatedRequest): Promise<DashboardWorkflowRunDto[]> {
    const workflowRuns = await this.dashboard.getAwaitingApproval(request.user);
    return workflowRuns.map(DashboardWorkflowRunDto.fromModel);
  }

  /**
   * List the 15 newest visible workflow contexts whose latest terminal run failed.
   *
   * @param request - Authenticated request user.
   * @returns Current terminal failures ordered newest first.
   */
  @Get('failures')
  @ApiOperation({ summary: 'List the 15 newest workflow contexts whose latest terminal run failed' })
  @ApiOkResponse({ description: 'Visible latest failed workflow runs.', type: DashboardWorkflowRunDto, isArray: true })
  async getLatestFailures(@Req() request: AuthenticatedRequest): Promise<DashboardWorkflowRunDto[]> {
    const failures = await this.dashboard.getLatestFailures(request.user);
    return failures.map(DashboardWorkflowRunDto.fromModel);
  }

  /**
   * List the ten newest workflow runs visible to the caller.
   *
   * @param request - Authenticated request user.
   * @returns The ten most recently created visible provider runs.
   */
  @Get('latest-runs')
  @ApiOperation({ summary: 'List the ten newest visible workflow runs' })
  @ApiOkResponse({ description: 'The ten newest visible workflow runs.', type: DashboardWorkflowRunDto, isArray: true })
  async getLatestRuns(@Req() request: AuthenticatedRequest): Promise<DashboardWorkflowRunDto[]> {
    const workflowRuns = await this.dashboard.getLatestRuns(request.user);
    return workflowRuns.map(DashboardWorkflowRunDto.fromModel);
  }

  /**
   * Summarize visible workflow health for one requested time range.
   *
   * @param request - Authenticated request user.
   * @param query - Requested inclusive time range.
   * @returns Period metrics and current visible workflow state.
   * @throws BadRequestException - The dashboard start timestamp must not be after the end timestamp.
   */
  @Get('summary')
  @ApiOperation({ summary: 'Get visible workflow health summary' })
  @ApiOkResponse({ description: 'Permission-aware workflow health summary.', type: DashboardSummaryDto })
  async getSummary(
    @Req() request: AuthenticatedRequest,
    @Query() query: DashboardPeriodQueryDto,
  ): Promise<DashboardSummaryDto> {
    return this.dashboard.getSummary(request.user, query);
  }

  /**
   * Rank visible repositories by workflow health for one requested time range.
   *
   * @param request - Authenticated request user.
   * @param query - Requested inclusive time range.
   * @returns Repositories with the most relevant health aggregates first.
   * @throws BadRequestException - The dashboard start timestamp must not be after the end timestamp.
   */
  @Get('repositories')
  @ApiOperation({ summary: 'Get visible repository workflow health' })
  @ApiOkResponse({
    description: 'Permission-aware repository health aggregates.',
    type: RepositoryHealthDto,
    isArray: true,
  })
  async getRepositoryHealth(
    @Req() request: AuthenticatedRequest,
    @Query() query: DashboardPeriodQueryDto,
  ): Promise<RepositoryHealthDto[]> {
    return this.dashboard.getRepositoryHealth(request.user, query);
  }

  /**
   * Aggregate visible completed runs into success and error buckets for a requested time range.
   *
   * @param request - Authenticated request user.
   * @param query - Requested time range and UTC bucket size.
   * @returns Continuous success and error trend buckets.
   * @throws BadRequestException - When the requested range is invalid.
   */
  @Get('trend')
  @ApiOperation({ summary: 'Get success and error workflow-run trend buckets' })
  @ApiOkResponse({ description: 'Visible workflow-run trend buckets.', type: WorkflowRunTrendBucketDto, isArray: true })
  async getTrend(
    @Req() request: AuthenticatedRequest,
    @Query() query: WorkflowRunTrendQueryDto,
  ): Promise<WorkflowRunTrendBucketDto[]> {
    return this.dashboard.getTrend(request.user, query);
  }
}
