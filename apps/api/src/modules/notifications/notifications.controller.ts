import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, ApiResourceQuery, QueryTransformPipe, ResourceQuery } from '@querry-kit/nest';

import { CaslAction } from '../../casl/casl-action.js';
import { CaslSubject } from '../../casl/casl-subject.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { Authenticated } from '../auth/authenticated.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  CreateNotificationChannelDto,
  NotificationChannelDto,
  UpdateNotificationChannelDto,
} from './dto/notification-channel.dto.js';
import { NotificationDeliveryDto } from './dto/notification-delivery.dto.js';
import { NotificationChannelQueryDto } from './dto/notification-query.dto.js';
import { NotificationChannelsQueryService } from './notification-query.service.js';
import { NotificationsService } from './notifications.service.js';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

/** Provides configuration endpoints for global notification channels. */
@ApiTags('notifications')
@Authenticated()
@Controller('notification-channels')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly channelQueries: NotificationChannelsQueryService,
  ) {}

  /** List repositories available as optional event filters. */
  @Get('manageable-repositories')
  @ApiOkResponse({ isArray: true })
  async manageableRepositories(@Req() request: AuthenticatedRequest) {
    return this.notifications.listFilterRepositories(request.user);
  }

  /** Query channels with server-side filtering, sorting and pagination. */
  @Get('query')
  @ApiResourceQuery()
  @ApiPaginatedResponse({ description: 'Visible notification channels.', model: NotificationChannelDto })
  async query(
    @Req() request: AuthenticatedRequest,
    @Query(new QueryTransformPipe()) query: NotificationChannelQueryDto,
  ) {
    const ability = await this.channelQueries.getReadAbility(request.user);
    return ResourceQuery.query({
      ability,
      include: {
        eventSubscriptions: {
          include: { repositories: { select: { repositoryId: true } } },
          orderBy: { eventType: 'asc' },
        },
        recipients: { include: { user: { select: { id: true, username: true } } } },
      },
      map: (
        channel: Prisma.NotificationChannelGetPayload<{
          include: {
            eventSubscriptions: {
              include: { repositories: { select: { repositoryId: true } } };
            };
            recipients: { include: { user: { select: { id: true; username: true } } } };
          };
        }>,
      ) => NotificationChannelDto.fromModel(channel, ability.can(CaslAction.Manage, CaslSubject.NotificationChannel)),
      query: this.channelQueries.toQueryOptions(query),
      schema: {
        browserRecipients: true,
        canManage: true,
        createdAt: true,
        enabled: true,
        id: true,
        name: true,
        eventSubscriptions: true,
        requiresReconfiguration: true,
        type: true,
        updatedAt: true,
        urlScheme: true,
      },
      service: this.channelQueries,
    });
  }

  /** List global channels visible to every authenticated caller. */
  @Get()
  @ApiOperation({ summary: 'List visible notification channels' })
  @ApiOkResponse({ type: NotificationChannelDto, isArray: true })
  async list(@Req() request: AuthenticatedRequest): Promise<NotificationChannelDto[]> {
    return (await this.notifications.listChannels()).map((channel) =>
      NotificationChannelDto.fromModel(channel, request.user.role === 'SYSTEM_ADMIN'),
    );
  }

  /** Create a global channel as a system administrator. */
  @Post()
  @ApiOperation({ summary: 'Create a notification channel' })
  @ApiOkResponse({ type: NotificationChannelDto })
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreateNotificationChannelDto,
  ): Promise<NotificationChannelDto> {
    return NotificationChannelDto.fromModel(await this.notifications.createChannel(request.user, input));
  }

  /** Send one immediate, non-retrying test notification and return its history record. */
  @Post(':id/test')
  @ApiOperation({ summary: 'Test one notification channel' })
  @ApiOkResponse({ type: NotificationDeliveryDto })
  async test(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<NotificationDeliveryDto> {
    return NotificationDeliveryDto.fromModel(await this.notifications.testChannel(request.user, id));
  }

  /** Update a global channel as a system administrator. */
  @Patch(':id')
  @ApiOperation({ summary: 'Update a notification channel' })
  @ApiOkResponse({ type: NotificationChannelDto })
  async update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() input: UpdateNotificationChannelDto,
  ): Promise<NotificationChannelDto> {
    return NotificationChannelDto.fromModel(await this.notifications.updateChannel(request.user, id, input));
  }

  /** Delete a global channel as a system administrator. */
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a notification channel' })
  @ApiNoContentResponse()
  async remove(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    await this.notifications.deleteChannel(request.user, id);
  }
}
