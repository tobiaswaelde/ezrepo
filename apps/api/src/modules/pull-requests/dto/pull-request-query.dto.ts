import { ApiPropertyOptional } from '@nestjs/swagger';
import { QueryDTO } from '@querry-kit/nest';
import { Transform } from 'class-transformer';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

import type { PullRequestTypeMap } from '../pull-requests-query.service.js';

/** Paginated pull-request query with text search and AND-combined labels. */
export class PullRequestQueryDto extends QueryDTO<PullRequestTypeMap> {
  @ApiPropertyOptional({ description: 'Case-insensitive number or title search.', maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @Transform(({ value }: { value: string }) => value.trim())
  search?: string;

  @ApiPropertyOptional({
    description: 'Repeated label names; every selected label must be present.',
    isArray: true,
    type: String,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  @Transform(({ value }: { value: string | string[] }) => (Array.isArray(value) ? value : [value]))
  labels?: string[];
}
