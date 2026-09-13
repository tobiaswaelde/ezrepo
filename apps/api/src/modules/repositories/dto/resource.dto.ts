import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { filterCaslFields } from '@querry-kit/nest/casl';

import { CaslAction } from '../../../casl/casl-action.js';
import { CaslSubject } from '../../../casl/casl-subject.js';
import type { AppAbility } from '../../../casl/types.js';
import type {
  ProviderAccount,
  Repository,
  RepositoryMembership,
  User,
  WorkflowFilter,
  WorkflowRun,
} from '../../../generated/prisma/client.js';

/** Public provider-account representation that deliberately excludes its access token. */
export class ProviderAccountDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ enum: ['GITHUB', 'GITLAB', 'FORGEJO', 'GITEA'] })
  providerType!: ProviderAccount['providerType'];
  @ApiProperty({ maxLength: 255 })
  displayName!: string;
  @ApiPropertyOptional({ format: 'uri', nullable: true })
  baseUrl!: string | null;
  @ApiProperty()
  enabled!: boolean;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lastSyncAt!: Date | null;

  /** Convert a provider account to its safe public representation. */
  static fromModel(model: ProviderAccount, ability?: AppAbility): ProviderAccountDto {
    return filterCaslFields(
      {
        id: model.id,
        providerType: model.providerType,
        displayName: model.displayName,
        baseUrl: model.baseUrl,
        enabled: model.enabled,
        lastSyncAt: model.lastSyncAt,
      },
      CaslSubject.ProviderAccount,
      ability,
      { action: CaslAction.Read },
    );
  }
}

/** Minimal safe user identity rendered in repository member avatar groups. */
export class RepositoryMemberSummaryDto {
  @ApiProperty({ format: 'date-time', nullable: true })
  avatarUpdatedAt!: Date | null;
  @ApiProperty({ maxLength: 255, nullable: true })
  firstName!: string | null;
  @ApiProperty({ maxLength: 255, nullable: true })
  lastName!: string | null;
  @ApiProperty({ format: 'uuid' })
  userId!: string;
  @ApiProperty({ maxLength: 255 })
  username!: string;
}

/** Public tracked-repository representation. */
export class RepositoryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  providerRepositoryId!: string;
  @ApiProperty()
  owner!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ format: 'uri' })
  url!: string;
  @ApiProperty()
  enabled!: boolean;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lastSyncAt!: Date | null;
  @ApiPropertyOptional({ nullable: true })
  workflowRunRetentionDays!: number | null;
  @ApiProperty({ format: 'uuid' })
  providerAccountId!: string;
  @ApiPropertyOptional({ minimum: 0 })
  workflowRunCount?: number;
  @ApiProperty({ isArray: true, type: () => RepositoryMemberSummaryDto })
  members!: RepositoryMemberSummaryDto[];

  /** Convert a tracked repository to a permission-filtered API response. */
  static fromModel(model: RepositoryResourceModel, ability?: AppAbility): RepositoryDto {
    return filterCaslFields(
      {
        id: model.id,
        providerRepositoryId: model.providerRepositoryId,
        owner: model.owner,
        name: model.name,
        url: model.url,
        enabled: model.enabled,
        lastSyncAt: model.lastSyncAt,
        workflowRunRetentionDays: model.workflowRunRetentionDays,
        providerAccountId: model.providerAccountId,
        members: (model.memberships ?? []).map((membership) => ({
          avatarUpdatedAt: membership.user.avatar?.updatedAt ?? null,
          firstName: membership.user.firstName,
          lastName: membership.user.lastName,
          userId: membership.userId,
          username: membership.user.username,
        })),
        ...(model._count ? { workflowRunCount: model._count.workflowRuns } : {}),
      },
      CaslSubject.Repository,
      ability,
      { action: CaslAction.Read },
    );
  }
}

/** Repository model with an optional workflow-run aggregate used by list endpoints. */
export type RepositoryResourceModel = Repository & {
  _count?: { workflowRuns: number };
  memberships?: Array<{
    user: { avatar: { updatedAt: Date } | null; firstName: string | null; lastName: string | null; username: string };
    userId: string;
  }>;
};

/** Public workflow-run representation used by dashboard and history endpoints. */
export class WorkflowRunDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  providerRunId!: string;
  @ApiProperty()
  workflowName!: string;
  @ApiProperty()
  displayTitle!: string;
  @ApiProperty({ format: 'uri' })
  url!: string;
  @ApiProperty({ format: 'date-time' })
  providerCreatedAt!: Date;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  startedAt!: Date | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true })
  durationMs!: number | null;
  @ApiProperty({ enum: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED', 'UNKNOWN'] })
  status!: WorkflowRun['status'];
  @ApiProperty({ format: 'uuid' })
  repositoryId!: string;
  @ApiProperty()
  repositoryName!: string;
  @ApiProperty()
  repositoryOwner!: string;
  @ApiProperty({ enum: ['GITHUB', 'GITLAB', 'FORGEJO', 'GITEA'] })
  providerType!: ProviderAccount['providerType'];

  /** Convert a normalized provider run to a permission-filtered API response. */
  static fromModel(model: WorkflowRunResourceModel, ability?: AppAbility): WorkflowRunDto {
    return filterCaslFields(
      {
        id: model.id,
        providerRunId: model.providerRunId,
        workflowName: model.workflowName,
        displayTitle: model.displayTitle,
        url: model.url,
        providerCreatedAt: model.providerCreatedAt,
        startedAt: model.startedAt,
        completedAt: model.completedAt,
        durationMs: model.durationMs,
        status: model.status,
        repositoryId: model.repositoryId,
        repositoryName: model.repository.name,
        repositoryOwner: model.repository.owner,
        providerType: model.repository.providerAccount.providerType,
      },
      CaslSubject.WorkflowRun,
      ability,
      { action: CaslAction.Read },
    );
  }
}

/** Workflow run with the minimal repository and provider context exposed by the resource endpoint. */
export type WorkflowRunResourceModel = Omit<
  WorkflowRun,
  | 'changeRequestCheckedAt'
  | 'changeRequestMergedAt'
  | 'changeRequestState'
  | 'changeRequestTargetBranch'
  | 'pullRequestId'
> & {
  repository: Pick<Repository, 'name' | 'owner'> & {
    providerAccount: Pick<ProviderAccount, 'providerType'>;
  };
};

/** Public workflow filter representation. */
export class WorkflowFilterDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ maxLength: 1024 })
  pattern!: string;
  @ApiProperty({ enum: ['ALLOW', 'DENY'] })
  mode!: WorkflowFilter['mode'];
  @ApiProperty({ format: 'uuid' })
  repositoryId!: string;

  /** Convert a workflow filter to a repository-scoped API response. */
  static fromModel(model: WorkflowFilter, ability?: AppAbility): WorkflowFilterDto {
    return filterCaslFields(
      { id: model.id, pattern: model.pattern, mode: model.mode, repositoryId: model.repositoryId },
      CaslSubject.Repository,
      ability,
      { action: CaslAction.Read },
    );
  }
}

/** Safe repository member representation without credential material. */
export class RepositoryMembershipDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ enum: ['VIEWER', 'MANAGER'] })
  role!: RepositoryMembership['role'];
  @ApiProperty({ format: 'uuid' })
  repositoryId!: string;
  @ApiProperty({ format: 'uuid' })
  userId!: string;
  @ApiProperty()
  user!: Pick<User, 'firstName' | 'id' | 'lastName' | 'role' | 'username'> & { avatarUpdatedAt: Date | null };

  /** Convert a membership and its safe user relation into a public representation. */
  static fromModel(
    model: RepositoryMembership & {
      user: Pick<User, 'firstName' | 'id' | 'lastName' | 'role' | 'username'> & {
        avatar: { updatedAt: Date } | null;
      };
    },
  ): RepositoryMembershipDto {
    return {
      id: model.id,
      repositoryId: model.repositoryId,
      role: model.role,
      user: {
        avatarUpdatedAt: model.user.avatar?.updatedAt ?? null,
        firstName: model.user.firstName,
        id: model.user.id,
        lastName: model.user.lastName,
        role: model.user.role,
        username: model.user.username,
      },
      userId: model.userId,
    };
  }
}
