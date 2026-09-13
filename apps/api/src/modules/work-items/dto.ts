import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { filterCaslFields } from '@querry-kit/nest/casl';

import { CaslAction } from '../../casl/casl-action.js';
import { CaslSubject } from '../../casl/casl-subject.js';
import type { AppAbility } from '../../casl/types.js';
import type { Issue, ProviderAccount, PullRequest, Repository } from '../../generated/prisma/client.js';

/** Provider identity safe to expose with a tracked work item. */
export class WorkItemActorDto {
  @ApiProperty()
  username!: string;
  @ApiPropertyOptional({ nullable: true })
  displayName!: string | null;
  @ApiPropertyOptional({ format: 'uri', nullable: true })
  avatarUrl!: string | null;
  @ApiPropertyOptional({ format: 'uri', nullable: true })
  url!: string | null;
}

/** Repository-specific provider label attached to a work item. */
export class WorkItemLabelDto {
  @ApiProperty()
  name!: string;
  @ApiPropertyOptional({ nullable: true })
  color!: string | null;
  @ApiPropertyOptional({ nullable: true })
  description!: string | null;
}

interface WorkItemRelations {
  assignees: Array<{ actor: WorkItemActorDto }>;
  author: WorkItemActorDto | null;
  labels: Array<{ label: WorkItemLabelDto }>;
  repository: Pick<Repository, 'name' | 'owner'> & {
    providerAccount: Pick<ProviderAccount, 'providerType'>;
  };
}

export type IssueResourceModel = Issue & WorkItemRelations;
export type PullRequestResourceModel = PullRequest & WorkItemRelations;

/** Public issue representation; descriptions are included only by detail endpoints. */
export class IssueDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  number!: string;
  @ApiProperty()
  title!: string;
  @ApiPropertyOptional({ nullable: true })
  body?: string | null;
  @ApiProperty({ enum: ['OPEN', 'CLOSED'] })
  state!: Issue['state'];
  @ApiProperty({ format: 'uri' })
  url!: string;
  @ApiProperty({ format: 'date-time' })
  providerCreatedAt!: Date;
  @ApiProperty({ format: 'date-time' })
  providerUpdatedAt!: Date;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  closedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true })
  milestone!: string | null;
  @ApiProperty({ format: 'uuid' })
  repositoryId!: string;
  @ApiProperty()
  repositoryName!: string;
  @ApiProperty()
  repositoryOwner!: string;
  @ApiProperty({ enum: ['GITHUB', 'GITLAB', 'FORGEJO', 'GITEA'] })
  providerType!: ProviderAccount['providerType'];
  @ApiPropertyOptional({ nullable: true, type: WorkItemActorDto })
  author!: WorkItemActorDto | null;
  @ApiProperty({ isArray: true, type: WorkItemActorDto })
  assignees!: WorkItemActorDto[];
  @ApiProperty({ isArray: true, type: WorkItemLabelDto })
  labels!: WorkItemLabelDto[];

  /** Project one issue with optional detail-only body content. */
  static fromModel(model: IssueResourceModel, includeBody = false, ability?: AppAbility): IssueDto {
    return filterCaslFields(
      {
        id: model.id,
        number: model.number,
        title: model.title,
        ...(includeBody ? { body: model.body } : {}),
        state: model.state,
        url: model.url,
        providerCreatedAt: model.providerCreatedAt,
        providerUpdatedAt: model.providerUpdatedAt,
        closedAt: model.closedAt,
        milestone: model.milestone,
        repositoryId: model.repositoryId,
        repositoryName: model.repository.name,
        repositoryOwner: model.repository.owner,
        providerType: model.repository.providerAccount.providerType,
        author: model.author,
        assignees: model.assignees.map(({ actor }) => actor),
        labels: model.labels.map(({ label }) => label),
      },
      CaslSubject.Issue,
      ability,
      { action: CaslAction.Read },
    );
  }
}

/** Public pull-request representation; descriptions are included only by detail endpoints. */
export class PullRequestDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ nullable: true }) body?: string | null;
  @ApiProperty({ enum: ['OPEN', 'CLOSED', 'MERGED'] }) state!: PullRequest['state'];
  @ApiProperty() draft!: boolean;
  @ApiProperty() sourceBranch!: string;
  @ApiProperty() targetBranch!: string;
  @ApiProperty({ format: 'uri' }) url!: string;
  @ApiProperty({ format: 'date-time' }) providerCreatedAt!: Date;
  @ApiProperty({ format: 'date-time' }) providerUpdatedAt!: Date;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) closedAt!: Date | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) mergedAt!: Date | null;
  @ApiProperty({ enum: ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'UNKNOWN'] })
  workflowStatus!: PullRequest['workflowStatus'];
  @ApiProperty() workflowApprovalRequired!: boolean;
  @ApiProperty({ format: 'uuid' }) repositoryId!: string;
  @ApiProperty() repositoryName!: string;
  @ApiProperty() repositoryOwner!: string;
  @ApiProperty({ enum: ['GITHUB', 'GITLAB', 'FORGEJO', 'GITEA'] }) providerType!: ProviderAccount['providerType'];
  @ApiPropertyOptional({ nullable: true, type: WorkItemActorDto }) author!: WorkItemActorDto | null;
  @ApiProperty({ isArray: true, type: WorkItemActorDto }) assignees!: WorkItemActorDto[];
  @ApiProperty({ isArray: true, type: WorkItemLabelDto }) labels!: WorkItemLabelDto[];

  /** Project one pull request with optional detail-only body content. */
  static fromModel(model: PullRequestResourceModel, includeBody = false, ability?: AppAbility): PullRequestDto {
    return filterCaslFields(
      {
        id: model.id,
        number: model.number,
        title: model.title,
        ...(includeBody ? { body: model.body } : {}),
        state: model.state,
        draft: model.draft,
        sourceBranch: model.sourceBranch,
        targetBranch: model.targetBranch,
        url: model.url,
        providerCreatedAt: model.providerCreatedAt,
        providerUpdatedAt: model.providerUpdatedAt,
        closedAt: model.closedAt,
        mergedAt: model.mergedAt,
        workflowStatus: model.workflowStatus,
        workflowApprovalRequired: model.workflowApprovalRequired,
        repositoryId: model.repositoryId,
        repositoryName: model.repository.name,
        repositoryOwner: model.repository.owner,
        providerType: model.repository.providerAccount.providerType,
        author: model.author,
        assignees: model.assignees.map(({ actor }) => actor),
        labels: model.labels.map(({ label }) => label),
      },
      CaslSubject.PullRequest,
      ability,
      { action: CaslAction.Read },
    );
  }
}

/** Permission-scoped issue counters used by overview and dashboard pages. */
export class IssueSummaryDto {
  @ApiProperty() open!: number;
  @ApiProperty() recentlyUpdated!: number;
  @ApiProperty() assigned!: number;
  @ApiProperty() stale!: number;
}

/** Permission-scoped pull-request counters used by overview and dashboard pages. */
export class PullRequestSummaryDto {
  @ApiProperty() open!: number;
  @ApiProperty() drafts!: number;
  @ApiProperty() failedWorkflows!: number;
  @ApiProperty() workflowApprovalRequired!: number;
}

/** Distinct visible values used to populate work-item filters. */
export class WorkItemFilterOptionsDto {
  @ApiProperty({ isArray: true, type: String }) labels!: string[];
  @ApiProperty({ isArray: true, type: String }) authors!: string[];
  @ApiProperty({ isArray: true, type: String }) assignees!: string[];
  @ApiProperty({ isArray: true, type: String }) milestones!: string[];
}
