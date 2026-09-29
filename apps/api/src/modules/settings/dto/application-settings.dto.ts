import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, Max, Min } from 'class-validator';

import { DefaultDateTimeFormat } from '../../../generated/prisma/client.js';

/** Global application settings returned to authenticated clients. */
export class ApplicationSettingsDto {
  @ApiProperty({ enum: DefaultDateTimeFormat })
  dateTimeFormat!: DefaultDateTimeFormat;

  @ApiProperty({ description: 'Default number of days closed issues are retained.', example: 90 })
  issueRetentionDays!: number;

  @ApiProperty({ description: 'Default number of days closed or merged pull requests are retained.', example: 90 })
  pullRequestRetentionDays!: number;

  @ApiProperty({ description: 'Default number of days completed workflow runs are retained.', example: 90 })
  workflowRunRetentionDays!: number;
}

/** Mutable global application settings available to system administrators. */
export class UpdateApplicationSettingsDto {
  @IsEnum(DefaultDateTimeFormat)
  @ApiProperty({ enum: DefaultDateTimeFormat })
  dateTimeFormat!: DefaultDateTimeFormat;

  @IsInt()
  @Min(1)
  @Max(3650)
  @ApiProperty({ maximum: 3650, minimum: 1 })
  issueRetentionDays!: number;

  @IsInt()
  @Min(1)
  @Max(3650)
  @ApiProperty({ maximum: 3650, minimum: 1 })
  pullRequestRetentionDays!: number;

  @IsInt()
  @Min(1)
  @Max(3650)
  @ApiProperty({ maximum: 3650, minimum: 1 })
  workflowRunRetentionDays!: number;
}
