import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
  ApiResourceQuery,
  QueryTransformPipe,
  ResourceQuery,
} from '@querry-kit/nest';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

import { PrismaService } from '../../prisma/prisma.service.js';
import { Authenticated } from '../auth/authenticated.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { RepositoryQueryDto } from './dto/repository-query.dto.js';
import { RepositoryWebhookConfigurationDto } from './dto/repository-webhook-configuration.dto.js';
import {
  RepositoryDto,
  RepositoryMembershipDto,
  WorkflowFilterDto,
  type RepositoryResourceModel,
} from './dto/resource.dto.js';
import { RepositoriesQueryService } from './repositories-query.service.js';
import { RepositoryConfigurationService } from './repository-configuration.service.js';

class UpdateRepositoryDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(1) workflowRunRetentionDays?: number | null;
}

class CreateWorkflowFilterDto {
  @IsEnum(['ALLOW', 'DENY']) mode!: 'ALLOW' | 'DENY';
  @IsString() @MaxLength(1024) pattern!: string;
}

class UpsertRepositoryMembershipDto {
  @IsEnum(['VIEWER', 'MANAGER']) role!: 'VIEWER' | 'MANAGER';
}

class SetRepositoryWebhookSecretDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  webhookSecret!: string;
}

const repositoryFieldSchema = {
  enabled: true,
  id: true,
  lastSyncAt: true,
  members: true,
  name: true,
  owner: true,
  providerAccountId: true,
  providerRepositoryId: true,
  url: true,
  workflowRunCount: true,
  workflowRunRetentionDays: true,
} as const;

/** Provides permission-scoped repository reads and administrator-only configuration. */
@Authenticated()
@Controller('repositories')
export class RepositoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: RepositoryConfigurationService,
    private readonly repositories: RepositoriesQueryService,
  ) {}

  /** Query repositories with server-side filtering, sorting, field selection, and pagination. */
  @Get()
  @ApiResourceQuery()
  @ApiPaginatedResponse({ description: 'Tracked repositories.', model: RepositoryDto })
  @ApiErrorResponses({ badRequestDescription: 'Invalid repository query.' })
  async query(@Req() request: { user: AuthenticatedUser }, @Query(new QueryTransformPipe()) query: RepositoryQueryDto) {
    const ability = await this.repositories.getReadAbility(request.user);
    return ResourceQuery.query({
      ability,
      include: {
        _count: { select: { workflowRuns: true } },
        memberships: {
          orderBy: { user: { username: 'asc' } },
          select: {
            userId: true,
            user: {
              select: { avatar: { select: { updatedAt: true } }, firstName: true, lastName: true, username: true },
            },
          },
        },
      },
      map: (repository: RepositoryResourceModel, currentAbility) => RepositoryDto.fromModel(repository, currentAbility),
      query: this.repositories.toQueryOptions(query),
      schema: repositoryFieldSchema,
      service: this.repositories,
    });
  }

  /** Return safe webhook setup metadata for all tracked repositories. */
  @Get('webhook-configurations')
  @ApiOkResponse({ type: RepositoryWebhookConfigurationDto, isArray: true })
  async webhookConfigurations(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<RepositoryWebhookConfigurationDto[]> {
    return this.configuration.listWebhookConfigurations(request.user);
  }

  /** Get one repository when it is visible to the authenticated user. */
  @Get(':id')
  async findById(@Req() request: { user: AuthenticatedUser }, @Param('id') id: string): Promise<RepositoryDto> {
    const ability = await this.repositories.getReadAbility(request.user);
    return RepositoryDto.fromModel(
      await this.repositories.findById<RepositoryResourceModel>(
        id,
        {
          include: {
            memberships: {
              orderBy: { user: { username: 'asc' } },
              select: {
                userId: true,
                user: {
                  select: { avatar: { select: { updatedAt: true } }, firstName: true, lastName: true, username: true },
                },
              },
            },
          },
        },
        ability,
      ),
      ability,
    );
  }

  /** List all workflow filters configured for one repository. */
  @Get(':id/workflow-filters')
  async listWorkflowFilters(
    @Req() request: { user: AuthenticatedUser },
    @Param('id') repositoryId: string,
  ): Promise<WorkflowFilterDto[]> {
    return (await this.configuration.listWorkflowFilters(request.user, repositoryId)).map((filter) =>
      WorkflowFilterDto.fromModel(filter),
    );
  }

  /** Add a validated workflow filter for one repository. */
  @Post(':id/workflow-filters')
  async createWorkflowFilter(
    @Req() request: { user: AuthenticatedUser },
    @Param('id') repositoryId: string,
    @Body() body: CreateWorkflowFilterDto,
  ): Promise<WorkflowFilterDto> {
    return WorkflowFilterDto.fromModel(await this.configuration.createWorkflowFilter(request.user, repositoryId, body));
  }

  /** Remove one workflow filter from the selected repository. */
  @Delete(':id/workflow-filters/:filterId')
  @HttpCode(204)
  async deleteWorkflowFilter(
    @Req() request: { user: AuthenticatedUser },
    @Param('id') repositoryId: string,
    @Param('filterId') filterId: string,
  ): Promise<void> {
    await this.configuration.deleteWorkflowFilter(request.user, repositoryId, filterId);
  }

  /** List every user assigned to one repository. */
  @Get(':id/memberships')
  async listMemberships(
    @Req() request: { user: AuthenticatedUser },
    @Param('id') repositoryId: string,
  ): Promise<RepositoryMembershipDto[]> {
    return (await this.configuration.listMemberships(request.user, repositoryId)).map((membership) =>
      RepositoryMembershipDto.fromModel(membership),
    );
  }

  /** Add or update one repository member role. */
  @Put(':id/memberships/:userId')
  async upsertMembership(
    @Req() request: { user: AuthenticatedUser },
    @Param('id') repositoryId: string,
    @Param('userId') userId: string,
    @Body() body: UpsertRepositoryMembershipDto,
  ): Promise<RepositoryMembershipDto> {
    return RepositoryMembershipDto.fromModel(
      await this.configuration.upsertMembership(request.user, repositoryId, { ...body, userId }),
    );
  }

  /** Remove one user's access to the selected repository. */
  @Delete(':id/memberships/:userId')
  @HttpCode(204)
  async deleteMembership(
    @Req() request: { user: AuthenticatedUser },
    @Param('id') repositoryId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.configuration.deleteMembership(request.user, repositoryId, userId);
  }

  /** Store or rotate the selected repository's webhook signing secret. */
  @Put(':id/webhook-configuration')
  @ApiOkResponse({ type: RepositoryWebhookConfigurationDto })
  async setWebhookSecret(
    @Req() request: { user: AuthenticatedUser },
    @Param('id') repositoryId: string,
    @Body() body: SetRepositoryWebhookSecretDto,
  ): Promise<RepositoryWebhookConfigurationDto> {
    return this.configuration.setWebhookSecret(request.user, repositoryId, body.webhookSecret);
  }

  /** Remove the selected repository's webhook signing secret. */
  @Delete(':id/webhook-configuration')
  @HttpCode(204)
  @ApiNoContentResponse()
  async clearWebhookSecret(
    @Req() request: { user: AuthenticatedUser },
    @Param('id') repositoryId: string,
  ): Promise<void> {
    await this.configuration.clearWebhookSecret(request.user, repositoryId);
  }

  @Patch(':id') async update(
    @Req() request: { user: AuthenticatedUser },
    @Param('id') id: string,
    @Body() body: UpdateRepositoryDto,
  ): Promise<RepositoryDto> {
    this.assertAdmin(request.user);
    return RepositoryDto.fromModel(await this.prisma.repository.update({ where: { id }, data: body }));
  }
  private assertAdmin(user: AuthenticatedUser): void {
    if (user.role !== 'SYSTEM_ADMIN') throw new ForbiddenException('System administrator access is required.');
  }
}
