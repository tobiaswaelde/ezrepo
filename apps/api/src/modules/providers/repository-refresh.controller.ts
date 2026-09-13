import { Controller, ForbiddenException, HttpCode, Param, Post, Req } from '@nestjs/common';

import { Authenticated } from '../auth/authenticated.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { RepositoryDto } from '../repositories/dto/resource.dto.js';
import { RepositoryMetadataService } from './repository-metadata.service.js';
import { ProviderSyncQueueService } from './sync-queue.service.js';

/** Provides an explicit administrator action for refreshing provider-owned repository metadata. */
@Authenticated()
@Controller('repositories')
export class RepositoryRefreshController {
  constructor(
    private readonly metadata: RepositoryMetadataService,
    private readonly syncQueue: ProviderSyncQueueService,
  ) {}

  /** Refresh the repository name, namespace, and URL without changing its provider identity. */
  @Post(':id/refresh')
  async refresh(
    @Req() request: { user: AuthenticatedUser },
    @Param('id') repositoryId: string,
  ): Promise<RepositoryDto> {
    return RepositoryDto.fromModel(await this.metadata.refreshById(request.user, repositoryId));
  }

  /** Queue an immediate, read-only workflow synchronization for one repository. */
  @Post(':id/sync')
  @HttpCode(202)
  async sync(@Req() request: { user: AuthenticatedUser }, @Param('id') repositoryId: string): Promise<void> {
    if (request.user.role !== 'SYSTEM_ADMIN') throw new ForbiddenException('System administrator access is required.');
    await this.syncQueue.enqueueRepositorySyncIfAvailable(repositoryId);
  }
}
