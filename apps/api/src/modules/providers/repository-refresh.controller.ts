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
  /**
   * Initialize RepositoryRefreshController with its required dependencies.
   *
   * @param metadata - Service refreshing tracked repository identity and location.
   * @param syncQueue - Durable queue for repository synchronization requests.
   */
  constructor(
    private readonly metadata: RepositoryMetadataService,
    private readonly syncQueue: ProviderSyncQueueService,
  ) {}

  /**
   * Refresh the repository name, namespace, and URL without changing its provider identity.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @param repositoryId - Local identifier of the tracked repository.
   * @returns The repository with its refreshed provider metadata.
   * @throws ForbiddenException - System administrator access is required.
   * @throws NotFoundException - Repository not found.
   * @throws BadRequestException - Provider account is disabled.
   * @throws ConflictException - Provider repository identity does not match the tracked repository.
   * @throws Error - When no adapter is registered for the requested provider type.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  @Post(':id/refresh')
  async refresh(
    @Req() request: { user: AuthenticatedUser },
    @Param('id') repositoryId: string,
  ): Promise<RepositoryDto> {
    return RepositoryDto.fromModel(await this.metadata.refreshById(request.user, repositoryId));
  }

  /**
   * Queue an immediate, read-only workflow synchronization for one repository.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @param repositoryId - Local identifier of the tracked repository.
   * @returns A promise that resolves when the operation completes.
   * @throws ForbiddenException - System administrator access is required.
   */
  @Post(':id/sync')
  @HttpCode(202)
  async sync(@Req() request: { user: AuthenticatedUser }, @Param('id') repositoryId: string): Promise<void> {
    if (request.user.role !== 'SYSTEM_ADMIN') throw new ForbiddenException('System administrator access is required.');
    await this.syncQueue.enqueueRepositorySyncIfAvailable(repositoryId);
  }
}
