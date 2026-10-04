import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const claimPath = /^[A-Za-z0-9_\-.:/@#~+]+$/;
const scopeToken = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

class OidcEndpointsDto {
  @ApiProperty()
  @IsBoolean()
  authorization!: boolean;
  @ApiProperty()
  @IsBoolean()
  jwks!: boolean;
  @ApiProperty()
  @IsBoolean()
  token!: boolean;
  @ApiProperty()
  @IsBoolean()
  userinfo!: boolean;
}

export class OidcStatusDto {
  @ApiProperty() enabled!: boolean;
  @ApiPropertyOptional() providerName?: string;
}

export class OidcConfigDto {
  @ApiProperty() allowHttpIssuer!: boolean;
  @ApiProperty() allowUnmatchedViewer!: boolean;
  @ApiProperty({ type: [String] }) managerGroups!: string[];
  @ApiProperty({ nullable: true }) clientId!: string | null;
  @ApiProperty() clientSecretConfigured!: boolean;
  @ApiProperty() configRevision!: number;
  @ApiProperty() callbackUrl!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() groupsClaim!: string;
  @ApiProperty({ nullable: true }) issuer!: string | null;
  @ApiProperty({ type: [String] }) observedGroups!: string[];
  @ApiProperty({ nullable: true }) providerName!: string | null;
  @ApiProperty({ type: [String] }) scopes!: string[];
  @ApiProperty() secretDecryptable!: boolean;
  @ApiProperty({ type: [String] }) systemAdministratorGroups!: string[];
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
  @ApiProperty({ type: [String] }) viewerGroups!: string[];
}

export class UpdateOidcConfigDto {
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  allowHttpIssuer?: boolean;
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  allowUnmatchedViewer?: boolean;
  @ApiPropertyOptional({ type: [String] })
  @MaxLength(512, { each: true })
  @IsString({ each: true })
  @ArrayMaxSize(100)
  @IsArray()
  @IsOptional()
  managerGroups?: string[];
  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @MaxLength(512)
  @MinLength(1)
  @IsOptional()
  clientId?: string | null;
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  clientSecretClear?: boolean;
  @ApiPropertyOptional({ writeOnly: true })
  @IsString()
  @MaxLength(4096)
  @MinLength(1)
  @IsOptional()
  clientSecret?: string;
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
  @ApiPropertyOptional()
  @Matches(claimPath)
  @IsString()
  @MaxLength(200)
  @MinLength(1)
  @IsOptional()
  groupsClaim?: string;
  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @MaxLength(2048)
  @MinLength(1)
  @IsOptional()
  issuer?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @MaxLength(64)
  @IsOptional()
  providerName?: string | null;
  @ApiPropertyOptional({ type: [String] })
  @Matches(scopeToken, { each: true })
  @MaxLength(128, { each: true })
  @IsString({ each: true })
  @ArrayMaxSize(20)
  @IsArray()
  @IsOptional()
  scopes?: string[];
  @ApiPropertyOptional({ type: [String] })
  @MaxLength(512, { each: true })
  @IsString({ each: true })
  @ArrayMaxSize(100)
  @IsArray()
  @IsOptional()
  systemAdministratorGroups?: string[];
  @ApiPropertyOptional({ type: [String] })
  @MaxLength(512, { each: true })
  @IsString({ each: true })
  @ArrayMaxSize(100)
  @IsArray()
  @IsOptional()
  viewerGroups?: string[];
}

export class OidcExchangeDto {
  @ApiProperty({ description: 'Opaque one-time browser handoff code.' })
  @IsString()
  @MinLength(43)
  @MaxLength(128)
  code!: string;
}

export class OidcCheckDto {
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional() code?: string;
  @ApiPropertyOptional({ type: OidcEndpointsDto })
  @ValidateNested()
  @Type(() => OidcEndpointsDto)
  endpoints?: OidcEndpointsDto;
  @ApiPropertyOptional() idTokenAlgorithm?: string;
  @ApiPropertyOptional() issuer?: string;
  @ApiPropertyOptional({ enum: ['client_secret_basic', 'client_secret_post', 'none'] })
  tokenEndpointAuthenticationMethod?: 'client_secret_basic' | 'client_secret_post' | 'none';
  @ApiPropertyOptional({ type: [String] }) warnings?: string[];
}
