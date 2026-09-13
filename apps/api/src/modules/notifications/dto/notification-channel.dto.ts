import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import {
  NotificationChannelType,
  NotificationEventType,
  type NotificationChannel,
} from '../../../generated/prisma/client.js';

export interface EmailNotificationConfigurationInput {
  from: string;
  password?: string;
  port?: number;
  recipients: string[];
  security: 'NONE' | 'STARTTLS' | 'TLS';
  smtpHost: string;
  username?: string;
}

export interface GotifyNotificationConfigurationInput {
  priority?: 'low' | 'moderate' | 'normal' | 'high';
  serverUrl: string;
  token: string;
}

export interface NtfyNotificationConfigurationInput {
  password?: string;
  priority?: 'min' | 'low' | 'default' | 'high' | 'max';
  serverUrl?: string;
  token?: string;
  topic: string;
  username?: string;
}

export interface DiscordNotificationConfigurationInput {
  webhookUrl: string;
}

export interface CustomAppriseNotificationConfigurationInput {
  url: string;
}

export type NotificationConfigurationInput =
  | EmailNotificationConfigurationInput
  | GotifyNotificationConfigurationInput
  | NtfyNotificationConfigurationInput
  | DiscordNotificationConfigurationInput
  | CustomAppriseNotificationConfigurationInput;

/** One global event subscription with optional repository and workflow filters. */
export class NotificationEventSubscriptionInputDto {
  @ApiProperty({ enum: NotificationEventType })
  @IsEnum(NotificationEventType)
  eventType!: NotificationEventType;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  repositoryIds?: string[];

  @ApiPropertyOptional({ type: [String], example: ['ci-*'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(1024, { each: true })
  workflowPatterns?: string[];
}

export interface NotificationChannelWithRelations extends NotificationChannel {
  eventSubscriptions: Array<{
    eventType: NotificationEventType;
    workflowPatterns: string[];
    repositories: Array<{ repositoryId: string }>;
  }>;
  recipients: Array<{ user: { id: string; username: string } }>;
}

/** Safe response representation of a global notification channel. */
export class NotificationChannelDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ enum: NotificationChannelType })
  type!: NotificationChannelType;
  @ApiProperty()
  enabled!: boolean;
  @ApiPropertyOptional({ example: 'discord' })
  urlScheme!: string | null;
  @ApiProperty({ type: [Object] })
  eventSubscriptions!: Array<{
    eventType: NotificationEventType;
    repositoryIds: string[];
    workflowPatterns: string[];
  }>;
  @ApiProperty({ type: [Object] })
  browserRecipients!: Array<{ id: string; username: string }>;
  @ApiProperty()
  canManage!: boolean;
  @ApiProperty()
  requiresReconfiguration!: boolean;
  @ApiProperty()
  createdAt!: Date;
  @ApiProperty()
  updatedAt!: Date;

  /** Convert a database model without exposing encrypted credentials. */
  static fromModel(model: NotificationChannelWithRelations, canManage = false): NotificationChannelDto {
    return {
      id: model.id,
      name: model.name,
      type: model.type,
      enabled: model.enabled,
      urlScheme: model.urlScheme,
      eventSubscriptions: model.eventSubscriptions.map((subscription) => ({
        eventType: subscription.eventType,
        repositoryIds: subscription.repositories.map(({ repositoryId }) => repositoryId),
        workflowPatterns: subscription.workflowPatterns,
      })),
      browserRecipients: model.recipients.map(({ user }) => user),
      canManage,
      requiresReconfiguration: model.requiresReconfiguration,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }
}

/** Input accepted when creating a global notification channel. */
export class CreateNotificationChannelDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ enum: NotificationChannelType, default: NotificationChannelType.CUSTOM_APPRISE })
  @IsOptional()
  @IsEnum(NotificationChannelType)
  type?: NotificationChannelType;

  @ApiProperty({ type: [NotificationEventSubscriptionInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => NotificationEventSubscriptionInputDto)
  eventSubscriptions!: NotificationEventSubscriptionInputDto[];

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  browserRecipientUserIds?: string[];

  /** Write-only structured destination configuration. */
  @ApiPropertyOptional({ writeOnly: true, type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  configuration?: NotificationConfigurationInput;

  /** Legacy write-only custom Apprise URL accepted for API compatibility. */
  @ApiPropertyOptional({ deprecated: true, writeOnly: true, maxLength: 4096 })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  url?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** Input accepted when updating a global notification channel. */
export class UpdateNotificationChannelDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ type: [NotificationEventSubscriptionInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => NotificationEventSubscriptionInputDto)
  eventSubscriptions?: NotificationEventSubscriptionInputDto[];

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  browserRecipientUserIds?: string[];

  /** Complete write-only replacement destination configuration. */
  @ApiPropertyOptional({ writeOnly: true, type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  configuration?: NotificationConfigurationInput;

  /** Legacy write-only custom Apprise URL accepted for API compatibility. */
  @ApiPropertyOptional({ deprecated: true, writeOnly: true, maxLength: 4096 })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
