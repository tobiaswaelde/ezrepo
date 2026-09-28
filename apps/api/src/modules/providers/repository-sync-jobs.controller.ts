import { Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, ApiPaginatedResponse, QueryTransformPipe } from '@querry-kit/nest';

import { Authenticated } from '../auth/authenticated.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  RepositorySyncJobDto,
  RepositorySyncJobQueryDto,
  RepositorySyncJobStartDto,
  RepositorySyncJobSummaryDto,
} from './dto/repository-sync-job.dto.js';
import { RepositorySyncJobsService } from './repository-sync-jobs.service.js';

/** Exposes the read-only provider synchronization queue and administrator start actions. */
@ApiTags('jobs')
@Authenticated()
@Controller('jobs/repository-sync')
export class RepositorySyncJobsController {
  /**
   * Initialize RepositorySyncJobsController with its required dependencies.
   *
   * @param jobs - Service listing visible synchronization jobs and enqueuing manual starts.
   */
  constructor(private readonly jobs: RepositorySyncJobsService) {}

  /**
   * Query visible records with filtering, sorting, and pagination.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @param query - Repository search text and pagination options for visible synchronization jobs.
   * @returns The visible resource page and its query metadata.
   */
  @Get()
  @ApiOperation({ summary: 'Query visible repository synchronization jobs' })
  @ApiPaginatedResponse({ description: 'Visible repository synchronization jobs.', model: RepositorySyncJobDto })
  @ApiErrorResponses({ badRequestDescription: 'Invalid repository synchronization job query.' })
  query(
    @Req() request: { user: AuthenticatedUser },
    @Query(new QueryTransformPipe()) query: RepositorySyncJobQueryDto,
  ) {
    return this.jobs.query(request.user, query);
  }

  /**
   * Count the current states of records visible to the authenticated user.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @returns State counts restricted to the resources visible to the caller.
   */
  @Get('summary')
  @ApiOkResponse({ type: RepositorySyncJobSummaryDto })
  summary(@Req() request: { user: AuthenticatedUser }): Promise<RepositorySyncJobSummaryDto> {
    return this.jobs.summary(request.user);
  }

  /**
   * Enqueue available repositories for manual synchronization after administrator authorization.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @returns A response containing the number of repositories queued for synchronization.
   * @throws ForbiddenException - System administrator access is required.
   */
  @Post('run')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: RepositorySyncJobStartDto })
  async runAll(@Req() request: { user: AuthenticatedUser }): Promise<RepositorySyncJobStartDto> {
    this.assertAdministrator(request.user);
    return { queuedCount: await this.jobs.startAll() };
  }

  /**
   * Enqueue a selected repository for manual synchronization after administrator authorization.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @param repositoryId - Local identifier of the tracked repository.
   * @returns A response containing the number of requests accepted for the selected repository.
   * @throws ForbiddenException - System administrator access is required.
   * @throws NotFoundException - Repository synchronization job not found.
   */
  @Post(':repositoryId/run')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: RepositorySyncJobStartDto })
  async run(
    @Req() request: { user: AuthenticatedUser },
    @Param('repositoryId') repositoryId: string,
  ): Promise<RepositorySyncJobStartDto> {
    this.assertAdministrator(request.user);
    return { queuedCount: await this.jobs.start(repositoryId) };
  }

  /**
   * Require system administrator access before starting repository synchronization.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @returns No return value.
   * @throws ForbiddenException - System administrator access is required.
   */
  private assertAdministrator(user: AuthenticatedUser): void {
    if (user.role !== 'SYSTEM_ADMIN') throw new ForbiddenException('System administrator access is required.');
  }
}
