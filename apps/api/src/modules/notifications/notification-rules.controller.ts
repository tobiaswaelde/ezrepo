import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, ApiResourceQuery, QueryTransformPipe, ResourceQuery } from '@querry-kit/nest';

import { CaslAction } from '../../casl/casl-action.js';
import { CaslSubject } from '../../casl/casl-subject.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { Authenticated } from '../auth/authenticated.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { NotificationRuleQueryDto } from './dto/notification-query.dto.js';
import {
  CreateNotificationRuleDto,
  NotificationRuleDto,
  UpdateNotificationRuleDto,
} from './dto/notification-rule.dto.js';
import { NotificationRulesQueryService } from './notification-query.service.js';
import { NotificationsService } from './notifications.service.js';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

/** Provides configuration endpoints for repository-scoped notification rules. */
@ApiTags('notifications')
@Authenticated()
@Controller('notification-rules')
export class NotificationRulesController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly ruleQueries: NotificationRulesQueryService,
  ) {}

  /** Query rules with server-side filtering, sorting and pagination. */
  @Get('query')
  @ApiResourceQuery()
  @ApiPaginatedResponse({ description: 'Visible notification rules.', model: NotificationRuleDto })
  async query(@Req() request: AuthenticatedRequest, @Query(new QueryTransformPipe()) query: NotificationRuleQueryDto) {
    const ability = await this.ruleQueries.getReadAbility(request.user);
    return ResourceQuery.query({
      ability,
      include: {
        channelLinks: { include: { notificationChannel: { select: { id: true, name: true, type: true } } } },
        repository: { select: { name: true, owner: true } },
      },
      map: (
        rule: Prisma.NotificationRuleGetPayload<{
          include: {
            channelLinks: { include: { notificationChannel: { select: { id: true; name: true; type: true } } } };
            repository: { select: { name: true; owner: true } };
          };
        }>,
      ) =>
        NotificationRuleDto.fromModel(
          rule,
          ability.can(CaslAction.Manage, {
            __caslSubjectType__: CaslSubject.NotificationRule,
            repositoryId: rule.repositoryId,
          } as never),
        ),
      query: this.ruleQueries.toQueryOptions(query),
      schema: {
        canManage: true,
        channelIds: true,
        channels: true,
        createdAt: true,
        enabled: true,
        id: true,
        outcome: true,
        repositoryId: true,
        repositoryName: true,
        repositoryOwner: true,
        updatedAt: true,
        workflowPattern: true,
      },
      service: this.ruleQueries,
    });
  }

  /** List only rules that belong to repositories visible to the caller. */
  @Get()
  @ApiOperation({ summary: 'List visible notification rules' })
  @ApiOkResponse({ type: NotificationRuleDto, isArray: true })
  async list(
    @Req() request: AuthenticatedRequest,
    @Query('repositoryId') repositoryId?: string,
  ): Promise<NotificationRuleDto[]> {
    return (await this.notifications.listRules(request.user, repositoryId)).map((rule) =>
      NotificationRuleDto.fromModel(rule),
    );
  }

  /** Create a rule for a repository the caller manages. */
  @Post()
  @ApiOperation({ summary: 'Create a notification rule' })
  @ApiOkResponse({ type: NotificationRuleDto })
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreateNotificationRuleDto,
  ): Promise<NotificationRuleDto> {
    return NotificationRuleDto.fromModel(await this.notifications.createRule(request.user, input));
  }

  /** Update a rule after repository-level management authorization. */
  @Patch(':id')
  @ApiOperation({ summary: 'Update a notification rule' })
  @ApiOkResponse({ type: NotificationRuleDto })
  async update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() input: UpdateNotificationRuleDto,
  ): Promise<NotificationRuleDto> {
    return NotificationRuleDto.fromModel(await this.notifications.updateRule(request.user, id, input));
  }

  /** Delete a rule after repository-level management authorization. */
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a notification rule' })
  @ApiNoContentResponse()
  async remove(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    await this.notifications.deleteRule(request.user, id);
  }
}
