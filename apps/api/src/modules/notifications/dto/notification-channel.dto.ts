import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { NotificationChannelType, type NotificationChannel } from '../../../generated/prisma/client.js';

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

type NotificationChannelWithRecipient = NotificationChannel & {
  browserRecipient?: { id: string; username: string } | null;
  repository?: { name: string; owner: string };
};

/** Safe response representation of a repository-scoped notification channel. */
export class NotificationChannelDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  repositoryId!: string;
  @ApiPropertyOptional()
  repositoryOwner!: string | null;
  @ApiPropertyOptional()
  repositoryName!: string | null;
  @ApiProperty()
  name!: string;
  @ApiProperty({ enum: NotificationChannelType })
  type!: NotificationChannelType;
  @ApiProperty()
  enabled!: boolean;
  @ApiPropertyOptional({ example: 'discord' })
  urlScheme!: string | null;
  @ApiPropertyOptional({ format: 'uuid' })
  browserRecipientUserId!: string | null;
  @ApiPropertyOptional()
  browserRecipientUsername!: string | null;
  @ApiProperty()
  canManage!: boolean;
  @ApiProperty()
  requiresReconfiguration!: boolean;
  @ApiProperty()
  createdAt!: Date;
  @ApiProperty()
  updatedAt!: Date;

  /** Convert a database model without exposing encrypted credentials. */
  static fromModel(model: NotificationChannelWithRecipient, canManage = false): NotificationChannelDto {
    return {
      id: model.id,
      repositoryId: model.repositoryId,
      repositoryOwner: model.repository?.owner ?? null,
      repositoryName: model.repository?.name ?? null,
      name: model.name,
      type: model.type,
      enabled: model.enabled,
      urlScheme: model.urlScheme,
      browserRecipientUserId: model.browserRecipientUserId,
      browserRecipientUsername: model.browserRecipient?.username ?? null,
      canManage,
      requiresReconfiguration: model.requiresReconfiguration,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }
}

/** Input accepted when creating a notification channel. */
export class CreateNotificationChannelDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  repositoryId!: string;
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  name!: string;
  @ApiPropertyOptional({ enum: NotificationChannelType, default: NotificationChannelType.CUSTOM_APPRISE })
  @IsOptional()
  @IsEnum(NotificationChannelType)
  type?: NotificationChannelType;
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

/** Input accepted when updating a notification channel. */
export class UpdateNotificationChannelDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
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
