import { ApiPropertyOptional } from '@nestjs/swagger';
import { QueryDTO } from '@querry-kit/nest';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import type { SecurityAlertTypeMap } from '../security-alerts-query.service.js';

/** Paginated security-alert query with case-insensitive text search. */
export class SecurityAlertQueryDto extends QueryDTO<SecurityAlertTypeMap> {
  @ApiPropertyOptional({ maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @Transform(({ value }: { value: string }) => value.trim())
  search?: string;
}
