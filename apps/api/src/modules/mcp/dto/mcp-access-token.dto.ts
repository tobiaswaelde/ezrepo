import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import type { McpAccessToken } from '../../../generated/prisma/client.js';

export type McpAccessTokenStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

/** Validated request for creating a user-owned MCP access token. */
export class CreateMcpAccessTokenDto {
  @ApiProperty({ maxLength: 100, minLength: 1 })
  @Transform(({ value }: { value: string }) => value.trim())
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}

/** Safe MCP token metadata that never contains the token hash or complete secret. */
export class McpAccessTokenDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  tokenPrefix!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lastUsedAt!: Date | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  expiresAt!: Date | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  revokedAt!: Date | null;

  @ApiProperty({ enum: ['ACTIVE', 'EXPIRED', 'REVOKED'] })
  status!: McpAccessTokenStatus;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  /**
   * Map persisted token metadata without exposing its hash.
   *
   * @param model - Loaded database record and relations required by the DTO mapping.
   * @param now - Reference time for deterministic time-dependent calculations.
   * @returns The explicit public DTO projected from the supplied record.
   */
  static fromModel(model: McpAccessToken, now = new Date()): McpAccessTokenDto {
    return {
      createdAt: model.createdAt,
      expiresAt: model.expiresAt,
      id: model.id,
      lastUsedAt: model.lastUsedAt,
      name: model.name,
      revokedAt: model.revokedAt,
      status: model.revokedAt ? 'REVOKED' : model.expiresAt && model.expiresAt <= now ? 'EXPIRED' : 'ACTIVE',
      tokenPrefix: model.tokenPrefix,
      userId: model.userId,
    };
  }
}

/** One-time token creation response containing the newly generated bearer secret. */
export class CreatedMcpAccessTokenDto extends McpAccessTokenDto {
  @ApiProperty({ writeOnly: true })
  token!: string;
}
