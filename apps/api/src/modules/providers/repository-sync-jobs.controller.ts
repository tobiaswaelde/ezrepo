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
  constructor(private readonly jobs: RepositorySyncJobsService) {}

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

  @Get('summary')
  @ApiOkResponse({ type: RepositorySyncJobSummaryDto })
  summary(@Req() request: { user: AuthenticatedUser }): Promise<RepositorySyncJobSummaryDto> {
    return this.jobs.summary(request.user);
  }

  @Post('run')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: RepositorySyncJobStartDto })
  async runAll(@Req() request: { user: AuthenticatedUser }): Promise<RepositorySyncJobStartDto> {
    this.assertAdministrator(request.user);
    return { queuedCount: await this.jobs.startAll() };
  }

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

  private assertAdministrator(user: AuthenticatedUser): void {
    if (user.role !== 'SYSTEM_ADMIN') throw new ForbiddenException('System administrator access is required.');
  }
}
