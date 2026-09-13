import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, ApiResourceQuery, QueryTransformPipe, ResourceQuery } from '@querry-kit/nest';

import { Authenticated } from '../auth/authenticated.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { NotificationDeliveryDto } from './dto/notification-delivery.dto.js';
import { NotificationDeliveryQueryDto } from './dto/notification-query.dto.js';
import { NotificationDeliveriesQueryService } from './notification-query.service.js';
import { NotificationsService } from './notifications.service.js';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

/** Exposes system-wide delivery history only to system administrators. */
@ApiTags('notifications')
@Authenticated()
@Controller('notification-deliveries')
export class NotificationDeliveriesController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly deliveryQueries: NotificationDeliveriesQueryService,
  ) {}

  /** Query authorized delivery history with server-side filtering, sorting and pagination. */
  @Get('query')
  @ApiResourceQuery()
  @ApiPaginatedResponse({ description: 'Authorized notification delivery history.', model: NotificationDeliveryDto })
  async query(
    @Req() request: AuthenticatedRequest,
    @Query(new QueryTransformPipe()) query: NotificationDeliveryQueryDto,
  ) {
    const ability = await this.deliveryQueries.getReadAbility(request.user);
    return ResourceQuery.query({
      ability,
      include: {
        attempts: {
          include: {
            browserPushSubscription: { select: { id: true } },
            notificationChannel: { select: { name: true, type: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        issue: { select: { id: true, number: true, title: true, url: true } },
        notificationChannel: { select: { id: true, name: true, type: true } },
        pullRequest: { select: { id: true, number: true, title: true, url: true } },
        repository: { select: { id: true, name: true, owner: true } },
        requestedBy: { select: { username: true } },
        workflowRun: { select: { id: true, url: true, workflowName: true } },
      },
      map: (delivery: unknown) => NotificationDeliveryDto.fromModel(delivery as never),
      query: this.deliveryQueries.toQueryOptions(query),
      schema: {
        attempts: true,
        createdAt: true,
        eventType: true,
        finalError: true,
        id: true,
        kind: true,
        nextAttemptAt: true,
        notificationChannelId: true,
        notificationChannelName: true,
        notificationChannelType: true,
        repositoryId: true,
        repositoryName: true,
        repositoryOwner: true,
        requestedByUsername: true,
        status: true,
        subjectKind: true,
        subjectTitle: true,
        subjectUrl: true,
        updatedAt: true,
      },
      service: this.deliveryQueries,
    });
  }

  /** List delivery history visible to a system administrator. */
  @Get()
  @ApiOperation({ summary: 'List visible notification delivery history' })
  @ApiOkResponse({ type: NotificationDeliveryDto, isArray: true })
  async list(
    @Req() request: AuthenticatedRequest,
    @Query('repositoryId') repositoryId?: string,
  ): Promise<NotificationDeliveryDto[]> {
    return (await this.notifications.listDeliveryHistory(request.user, repositoryId)).map(
      NotificationDeliveryDto.fromModel,
    );
  }
}
