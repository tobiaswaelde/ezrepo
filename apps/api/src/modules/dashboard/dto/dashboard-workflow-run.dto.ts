import { ApiProperty } from '@nestjs/swagger';

import type { ProviderAccount, Repository, WorkflowRun } from '../../../generated/prisma/client.js';

/** Safe provider identity displayed alongside a dashboard workflow run. */
export class DashboardProviderDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['GITHUB', 'GITLAB', 'FORGEJO', 'GITEA'] })
  providerType!: ProviderAccount['providerType'];

  @ApiProperty()
  displayName!: string;
}

/** Safe repository identity and link displayed alongside a dashboard workflow run. */
export class DashboardRepositoryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  owner!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  url!: string;
}

/** Dashboard representation of a workflow run with repository and provider context. */
export class DashboardWorkflowRunDto {
  @ApiProperty()
  awaitingApproval!: boolean;

  @ApiProperty()
  id!: string;

  @ApiProperty()
  providerRunId!: string;

  @ApiProperty()
  workflowName!: string;

  @ApiProperty()
  displayTitle!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty()
  providerCreatedAt!: Date;

  @ApiProperty({ nullable: true })
  startedAt!: Date | null;

  @ApiProperty({ nullable: true })
  completedAt!: Date | null;

  @ApiProperty({ nullable: true })
  durationMs!: number | null;

  @ApiProperty({ nullable: true })
  reviewUrl!: string | null;

  @ApiProperty({ enum: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED', 'UNKNOWN'] })
  status!: WorkflowRun['status'];

  @ApiProperty({ type: DashboardRepositoryDto })
  repository!: DashboardRepositoryDto;

  @ApiProperty({ type: DashboardProviderDto })
  provider!: DashboardProviderDto;

  /**
   * Map a loaded dashboard workflow run to its explicit safe public representation.
   *
   * @param model - Loaded database record and relations required by the DTO mapping.
   * @returns The explicit public DTO projected from the supplied record.
   */
  static fromModel(model: DashboardWorkflowRunModel): DashboardWorkflowRunDto {
    return {
      awaitingApproval: model.awaitingApproval,
      id: model.id,
      providerRunId: model.providerRunId,
      workflowName: model.workflowName,
      displayTitle: model.displayTitle,
      url: model.url,
      providerCreatedAt: model.providerCreatedAt,
      startedAt: model.startedAt,
      completedAt: model.completedAt,
      durationMs: model.durationMs,
      reviewUrl: model.reviewUrl,
      status: model.status,
      repository: {
        id: model.repository.id,
        owner: model.repository.owner,
        name: model.repository.name,
        url: model.repository.url,
      },
      provider: {
        id: model.repository.providerAccount.id,
        providerType: model.repository.providerAccount.providerType,
        displayName: model.repository.providerAccount.displayName,
      },
    };
  }
}

/** Workflow run with the safe repository and provider relations required by the dashboard. */
export type DashboardWorkflowRunModel = WorkflowRun & {
  repository: Pick<Repository, 'id' | 'name' | 'owner' | 'url'> & {
    providerAccount: Pick<ProviderAccount, 'displayName' | 'id' | 'providerType'>;
  };
};
