import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QueryDTO } from '@querry-kit/nest';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import type { ProviderAccount, Repository, RepositorySyncRequest } from '../../../generated/prisma/client.js';
import type { RepositoryTypeMap } from '../../repositories/repositories-query.service.js';
import type { ProviderSyncScope } from '../provider-adapter.js';

export type RepositorySyncJobModel = Repository & {
  providerAccount: Pick<ProviderAccount, 'displayName' | 'providerType'>;
  syncRequest: RepositorySyncRequest | null;
};

/** Query parameters for the paginated repository synchronization job list. */
export class RepositorySyncJobQueryDto extends QueryDTO<RepositoryTypeMap> {
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @Transform(({ value }: { value: string }) => value.trim())
  search?: string;
}

/** One permanently available repository synchronization job. */
export class RepositorySyncJobDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  repositoryName!: string;
  @ApiProperty()
  repositoryOwner!: string;
  @ApiProperty()
  providerName!: string;
  @ApiProperty({ enum: ['GITHUB', 'GITLAB', 'FORGEJO', 'GITEA'] })
  providerType!: ProviderAccount['providerType'];
  @ApiProperty({ enum: ['IDLE', 'PENDING', 'RUNNING', 'FAILED'] })
  status!: 'IDLE' | RepositorySyncRequest['status'];
  @ApiProperty({ enum: ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS'], isArray: true })
  scopes!: ProviderSyncScope[];
  @ApiProperty()
  attempt!: number;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  requestedAt!: Date | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  runAfter!: Date | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  startedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true })
  progressPhase!: RepositorySyncRequest['progressPhase'];
  @ApiPropertyOptional({ nullable: true })
  progressCurrent!: number | null;
  @ApiPropertyOptional({ nullable: true })
  progressTotal!: number | null;
  @ApiPropertyOptional({ nullable: true })
  lastError!: string | null;

  /** Convert a repository and its optional queue request to the public job representation. */
  static fromModel(model: RepositorySyncJobModel): RepositorySyncJobDto {
    const request = model.syncRequest;
    return {
      attempt: request?.attempt ?? 0,
      id: model.id,
      lastError: request?.lastError ?? null,
      progressCurrent: request?.progressCurrent ?? null,
      progressPhase: request?.progressPhase ?? null,
      progressTotal: request?.progressTotal ?? null,
      providerName: model.providerAccount.displayName,
      providerType: model.providerAccount.providerType,
      repositoryName: model.name,
      repositoryOwner: model.owner,
      requestedAt: request?.requestedAt ?? null,
      runAfter: request?.runAfter ?? null,
      scopes: request
        ? [
            ...(request.syncWorkflows ? ['WORKFLOWS' as const] : []),
            ...(request.syncIssues ? ['ISSUES' as const] : []),
            ...(request.syncPullRequests ? ['PULL_REQUESTS' as const] : []),
          ]
        : ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS'],
      startedAt: request?.startedAt ?? null,
      status: request?.status ?? 'IDLE',
    };
  }
}

/** Aggregate state counters for all visible repository synchronization jobs. */
export class RepositorySyncJobSummaryDto {
  @ApiProperty() total!: number;
  @ApiProperty() idle!: number;
  @ApiProperty() pending!: number;
  @ApiProperty() running!: number;
  @ApiProperty() failed!: number;
}

/** Number of repository synchronization jobs accepted by a manual start request. */
export class RepositorySyncJobStartDto {
  @ApiProperty() queuedCount!: number;
}
