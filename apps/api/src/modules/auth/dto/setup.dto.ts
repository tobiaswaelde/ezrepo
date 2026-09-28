import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Trim string names and normalize empty names to an omitted value.
 *
 * @param param0 - Transformer input containing the optional name value.
 * @returns The trimmed name, undefined for an empty string, or the original non-string value.
 */
const trimOptionalName = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || undefined : value;

/** Credentials and optional personal data used to create the first administrator. */
export class SetupDto {
  @IsOptional()
  @Transform(trimOptionalName)
  @IsString()
  @MaxLength(255)
  firstName?: string;

  @IsOptional()
  @Transform(trimOptionalName)
  @IsString()
  @MaxLength(255)
  lastName?: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  username!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(256)
  password!: string;
}
