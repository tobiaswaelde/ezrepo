import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
  ApiResourceQuery,
  QueryTransformPipe,
  ResourceQuery,
} from '@querry-kit/nest';

import { IsBoolean, IsEnum, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import type { ProviderAccount } from '../../generated/prisma/client.js';

import { Authenticated } from '../auth/authenticated.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { ProviderAccountDto, RepositoryDto } from '../repositories/dto/resource.dto.js';
import { ProviderAccountQueryDto } from './dto/provider-account-query.dto.js';
import { StartProviderOAuthDto, type ProviderOAuthAuthorizationDto } from './dto/provider-oauth.dto.js';
import { ProviderRepositoryDto } from './dto/provider-repository.dto.js';
import { ProviderWebhookConfigurationDto } from './dto/provider-webhook-configuration.dto.js';
import { ProviderAccountsQueryService } from './provider-accounts-query.service.js';
import { ProviderAccountsService } from './provider-accounts.service.js';
import { ProviderOAuthService } from './provider-oauth.service.js';

class CreateProviderAccountDto {
  @IsEnum(['GITHUB', 'GITLAB', 'FORGEJO', 'GITEA']) providerType!: 'GITHUB' | 'GITLAB' | 'FORGEJO' | 'GITEA';
  @IsString() @MaxLength(255) displayName!: string;
  @IsString() @MinLength(1) @MaxLength(4096) accessToken!: string;
  @IsOptional() @IsUrl() baseUrl?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(4096) webhookSecret?: string;
}

class UpdateProviderAccountDto {
  @IsOptional() @IsString() @MaxLength(255) displayName?: string;
  @IsOptional() @IsUrl() baseUrl?: string | null;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(4096) accessToken?: string;
  @IsOptional() @IsString() @MaxLength(4096) webhookSecret?: string;
  @IsOptional() @IsBoolean() clearWebhookSecret?: boolean;
}

class CreateTrackedRepositoryDto {
  @IsString() @MinLength(1) @MaxLength(255) providerRepositoryId!: string;
}
@Authenticated()
@Controller('provider-accounts')
export class ProviderAccountsController {
  constructor(
    private readonly accounts: ProviderAccountsService,
    private readonly accountQueries: ProviderAccountsQueryService,
    private readonly oauth: ProviderOAuthService,
  ) {}

  /** Query provider accounts with server-side filtering, sorting, field selection, and pagination. */
  @Get()
  @ApiResourceQuery()
  @ApiPaginatedResponse({ description: 'Configured provider accounts.', model: ProviderAccountDto })
  @ApiErrorResponses({ badRequestDescription: 'Invalid provider-account query.' })
  async query(
    @Req() req: { user: AuthenticatedUser },
    @Query(new QueryTransformPipe()) query: ProviderAccountQueryDto,
  ) {
    const ability = this.accountQueries.getReadAbility(req.user);
    return ResourceQuery.query({
      ability,
      map: (account: ProviderAccount, currentAbility) => ProviderAccountDto.fromModel(account, currentAbility),
      query: this.accountQueries.toQueryOptions(query),
      schema: ProviderAccountDto,
      service: this.accountQueries,
    });
  }
  /** Returns providers for which this installation has a configured OAuth client. */
  @Get('authentication-options') authenticationOptions(@Req() req: { user: AuthenticatedUser }): {
    oauthProviderTypes: Array<'GITHUB' | 'GITLAB' | 'FORGEJO'>;
  } {
    this.accounts.assertAdmin(req.user);
    return { oauthProviderTypes: this.oauth.availableProviderTypes() };
  }
  /** Return safe webhook setup metadata for all configured provider accounts. */
  @Get('webhook-configurations')
  @ApiOkResponse({ isArray: true, type: ProviderWebhookConfigurationDto })
  async webhookConfigurations(@Req() req: { user: AuthenticatedUser }): Promise<ProviderWebhookConfigurationDto[]> {
    return this.accounts.listWebhookConfigurations(req.user);
  }
  /** Discover repositories accessible through an enabled provider account. */
  @Get(':id/repositories')
  async listRepositories(
    @Req() req: { user: AuthenticatedUser },
    @Param('id') providerAccountId: string,
  ): Promise<ProviderRepositoryDto[]> {
    return (await this.accounts.listAvailableRepositories(req.user, providerAccountId)).map((repository) =>
      ProviderRepositoryDto.fromProvider(repository, repository.tracked),
    );
  }
  /** Adds a provider account with a manually supplied personal access token. */
  @Post() async create(
    @Req() req: { user: AuthenticatedUser },
    @Body() body: CreateProviderAccountDto,
  ): Promise<ProviderAccountDto> {
    return ProviderAccountDto.fromModel(await this.accounts.create(req.user, body));
  }
  /** Add one repository selected from the provider's live repository list. */
  @Post(':id/repositories')
  async addRepository(
    @Req() req: { user: AuthenticatedUser },
    @Param('id') providerAccountId: string,
    @Body() body: CreateTrackedRepositoryDto,
  ): Promise<RepositoryDto> {
    return RepositoryDto.fromModel(
      await this.accounts.addRepository(req.user, providerAccountId, body.providerRepositoryId),
    );
  }
  /** Starts an OAuth authorization for a new provider account. */
  @Post('oauth/authorize') async authorize(
    @Req() req: { user: AuthenticatedUser },
    @Body() body: StartProviderOAuthDto,
  ): Promise<ProviderOAuthAuthorizationDto> {
    return this.oauth.start(req.user, body);
  }
  @Patch(':id') async update(
    @Req() req: { user: AuthenticatedUser },
    @Param('id') id: string,
    @Body() body: UpdateProviderAccountDto,
  ): Promise<ProviderAccountDto> {
    return ProviderAccountDto.fromModel(await this.accounts.update(req.user, id, body));
  }
  @Delete(':id') @HttpCode(204) async remove(
    @Req() req: { user: AuthenticatedUser },
    @Param('id') id: string,
  ): Promise<void> {
    await this.accounts.remove(req.user, id);
  }
}
