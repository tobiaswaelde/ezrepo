import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import type { NotificationChannelType, NotificationRule } from '../../../generated/prisma/client.js';
import { NotificationRuleOutcome } from '../../../generated/prisma/client.js';

/** Public representation of a repository-scoped notification rule. */
export class NotificationRuleDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  repositoryId!: string;
  @ApiPropertyOptional()
  repositoryOwner!: string | null;
  @ApiPropertyOptional()
  repositoryName!: string | null;

  @ApiProperty({ maxLength: 1024 })
  workflowPattern!: string;

  @ApiProperty({ enum: NotificationRuleOutcome })
  outcome!: NotificationRuleOutcome;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ type: [String] })
  channelIds!: string[];
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  channels!: Array<{ id: string; name: string; type: NotificationChannelType }>;
  @ApiProperty()
  canManage!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  /** Convert a rule and its channel links to an API response. */
  static fromModel(
    model: NotificationRule & {
      channelLinks: Array<{
        notificationChannel?: { id: string; name: string; type: NotificationChannelType };
        notificationChannelId: string;
      }>;
      repository?: { name: string; owner: string };
    },
    canManage = false,
  ): NotificationRuleDto {
    return {
      id: model.id,
      repositoryId: model.repositoryId,
      repositoryOwner: model.repository?.owner ?? null,
      repositoryName: model.repository?.name ?? null,
      workflowPattern: model.workflowPattern,
      outcome: model.outcome,
      enabled: model.enabled,
      channelIds: model.channelLinks.map((link) => link.notificationChannelId),
      channels: model.channelLinks.flatMap((link) => (link.notificationChannel ? [link.notificationChannel] : [])),
      canManage,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }
}

/** Input accepted when creating a notification rule. */
export class CreateNotificationRuleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  repositoryId!: string;

  @ApiProperty({ maxLength: 1024 })
  @IsString()
  @MaxLength(1024)
  workflowPattern!: string;

  @ApiProperty({ enum: NotificationRuleOutcome })
  @IsEnum(NotificationRuleOutcome)
  outcome!: NotificationRuleOutcome;

  @ApiProperty({ type: [String], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  channelIds!: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** Input accepted when updating a notification rule. */
export class UpdateNotificationRuleDto {
  @ApiPropertyOptional({ maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  workflowPattern?: string;

  @ApiPropertyOptional({ enum: NotificationRuleOutcome })
  @IsOptional()
  @IsEnum(NotificationRuleOutcome)
  outcome?: NotificationRuleOutcome;

  @ApiPropertyOptional({ type: [String], minItems: 1 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  channelIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
