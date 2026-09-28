import { Injectable, NotFoundException } from '@nestjs/common';
import { PageMetaDTO } from '@querry-kit/nest';

import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { RepositoriesQueryService } from '../repositories/repositories-query.service.js';
import {
  RepositorySyncJobDto,
  type RepositorySyncJobModel,
  type RepositorySyncJobQueryDto,
  type RepositorySyncJobSummaryDto,
} from './dto/repository-sync-job.dto.js';
import { ProviderSyncQueueService } from './sync-queue.service.js';

/** Provides permission-scoped repository synchronization job reads and starts. */
@Injectable()
export class RepositorySyncJobsService {
  /**
   * Initialize RepositorySyncJobsService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   * @param repositories - Ability-aware repository query service.
   * @param queue - Durable repository synchronization queue.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly repositories: RepositoriesQueryService,
    private readonly queue: ProviderSyncQueueService,
  ) {}

  /**
   * Query permanently available synchronization jobs for visible enabled repositories.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @param query - Repository search text and pagination options for visible synchronization jobs.
   * @returns The visible resource page and its query metadata.
   */
  async query(user: AuthenticatedUser, query: RepositorySyncJobQueryDto) {
    const ability = await this.repositories.getReadAbility(user);
    const searchWhere = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { owner: { contains: query.search, mode: 'insensitive' as const } },
            { providerAccount: { displayName: { contains: query.search, mode: 'insensitive' as const } } },
          ],
        }
      : {};
    const where = { AND: [this.repositories.visibleWhere(ability), { enabled: true }, searchWhere] };
    const [itemCount, repositories] = await Promise.all([
      this.prisma.repository.count({ where }),
      this.prisma.repository.findMany({
        include: { providerAccount: { select: { displayName: true, providerType: true } }, syncRequest: true },
        orderBy: [{ owner: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
        where,
      }),
    ]);
    return {
      items: (repositories as RepositorySyncJobModel[]).map(RepositorySyncJobDto.fromModel),
      meta: new PageMetaDTO({ itemCount, pageOptions: query }),
    };
  }

  /**
   * Count each synchronization state across visible enabled repositories.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @returns State counts restricted to the resources visible to the caller.
   */
  async summary(user: AuthenticatedUser): Promise<RepositorySyncJobSummaryDto> {
    const ability = await this.repositories.getReadAbility(user);
    const where = { AND: [this.repositories.visibleWhere(ability), { enabled: true }] };
    const [total, pending, running, failed] = await Promise.all([
      this.prisma.repository.count({ where }),
      this.prisma.repository.count({ where: { AND: [where, { syncRequest: { status: 'PENDING' } }] } }),
      this.prisma.repository.count({ where: { AND: [where, { syncRequest: { status: 'RUNNING' } }] } }),
      this.prisma.repository.count({ where: { AND: [where, { syncRequest: { status: 'FAILED' } }] } }),
    ]);
    return { failed, idle: total - pending - running - failed, pending, running, total };
  }

  /**
   * Start every currently idle or failed synchronization job.
   *
   * @returns The number of available repositories queued.
   */
  async startAll(): Promise<number> {
    return this.queue.enqueueAvailableRepositories();
  }

  /**
   * Start one enabled repository synchronization unless it is already active.
   *
   * @param repositoryId - Local identifier of the tracked repository.
   * @returns The number of synchronization requests accepted for the selected repository.
   * @throws NotFoundException - Repository synchronization job not found.
   */
  async start(repositoryId: string): Promise<number> {
    const repository = await this.prisma.repository.findFirst({
      select: { id: true },
      where: { enabled: true, id: repositoryId, providerAccount: { enabled: true } },
    });
    if (!repository) throw new NotFoundException('Repository synchronization job not found.');
    return (await this.queue.enqueueRepositorySyncIfAvailable(repositoryId)) ? 1 : 0;
  }
}
