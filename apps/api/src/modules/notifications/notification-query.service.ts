import { Injectable } from '@nestjs/common';
import {
  QueryService,
  createCaslAccessibleWhere,
  type BaseDelegateTypeMap,
  type QueryOptionsMap,
} from '@querry-kit/nest';

import { CaslAbilityFactory } from '../../casl/casl-ability.factory.js';
import { CaslAction } from '../../casl/casl-action.js';
import { CaslSubject } from '../../casl/casl-subject.js';
import type { AppAbility } from '../../casl/types.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import type { NotificationChannelQueryDto, NotificationDeliveryQueryDto } from './dto/notification-query.dto.js';

interface NotificationTypeMapBase extends BaseDelegateTypeMap {
  createInput: never;
  uncheckedCreateInput: never;
  updateManyMutationInput: never;
  uncheckedUpdateManyInput: never;
  updateInput: never;
  uncheckedUpdateInput: never;
}

export interface NotificationChannelTypeMap extends NotificationTypeMapBase {
  select: Prisma.NotificationChannelSelect;
  include: Prisma.NotificationChannelInclude;
  whereInput: Prisma.NotificationChannelWhereInput;
  orderByWithRelationInput: Prisma.NotificationChannelOrderByWithRelationInput;
  whereUniqueInput: Prisma.NotificationChannelWhereUniqueInput;
  scalarFieldEnum: Prisma.NotificationChannelScalarFieldEnum;
  aggregateInputType: Prisma.NotificationChannelAggregateArgs;
}

export interface NotificationDeliveryTypeMap extends NotificationTypeMapBase {
  select: Prisma.NotificationDeliverySelect;
  include: Prisma.NotificationDeliveryInclude;
  whereInput: Prisma.NotificationDeliveryWhereInput;
  orderByWithRelationInput: Prisma.NotificationDeliveryOrderByWithRelationInput;
  whereUniqueInput: Prisma.NotificationDeliveryWhereUniqueInput;
  scalarFieldEnum: Prisma.NotificationDeliveryScalarFieldEnum;
  aggregateInputType: Prisma.NotificationDeliveryAggregateArgs;
}

/**
 * Build notification resource permissions from the authenticated user role.
 *
 * @param prisma - Database client used for persisted application state.
 * @param abilityFactory - Factory for role- and membership-aware CASL abilities.
 * @param user - Authenticated user whose identity and permissions apply to the operation.
 * @returns Notification permissions for the current user role.
 */
async function buildAbility(
  prisma: PrismaService,
  abilityFactory: CaslAbilityFactory,
  user: AuthenticatedUser,
): Promise<AppAbility> {
  const memberships = await prisma.repositoryMembership.findMany({
    where: { userId: user.id },
    select: { repositoryId: true, role: true },
  });
  return abilityFactory.createForUser(user, memberships);
}

/** Query Kit adapter for global notification channels. */
@Injectable()
export class NotificationChannelsQueryService extends QueryService<
  typeof PrismaService.prototype.notificationChannel,
  NotificationChannelTypeMap,
  typeof PrismaService.prototype.notificationChannel,
  QueryOptionsMap<NotificationChannelTypeMap>,
  AppAbility,
  CaslSubject.NotificationChannel
> {
  /**
   * Initialize NotificationChannelsQueryService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   * @param abilityFactory - Factory for role- and membership-aware CASL abilities.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly abilityFactory: CaslAbilityFactory,
  ) {
    super(prisma.notificationChannel, {
      subject: CaslSubject.NotificationChannel,
      accessibleWhere: createCaslAccessibleWhere<AppAbility, CaslSubject.NotificationChannel, CaslAction>({
        action: CaslAction.Read,
      }),
    });
  }

  /**
   * Resolve the resource read ability for the authenticated user.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @returns The CASL ability used for resource queries and DTO projection.
   */
  getReadAbility(user: AuthenticatedUser): Promise<AppAbility> {
    return buildAbility(this.prisma, this.abilityFactory, user);
  }

  /**
   * Convert resource filters and sorting into Query Kit options with stable default ordering.
   *
   * @param query - Validated filters, sorting, pagination, or time-range options.
   * @returns Query Kit options with explicit relation loading and stable default sorting.
   */
  toQueryOptions(query: NotificationChannelQueryDto): QueryOptionsMap<NotificationChannelTypeMap>['query'] {
    const { search, where, ...options } = query;
    const searchWhere: Prisma.NotificationChannelWhereInput | undefined = search
      ? { name: { contains: search, mode: 'insensitive' } }
      : undefined;
    return {
      ...options,
      where: searchWhere ? { AND: [where ?? {}, searchWhere] } : where,
      orderBy: query.orderBy ?? [{ name: 'asc' }, { id: 'asc' }],
    };
  }
}

/** Query Kit adapter for system-administrator notification delivery history. */
@Injectable()
export class NotificationDeliveriesQueryService extends QueryService<
  typeof PrismaService.prototype.notificationDelivery,
  NotificationDeliveryTypeMap,
  typeof PrismaService.prototype.notificationDelivery,
  QueryOptionsMap<NotificationDeliveryTypeMap>,
  AppAbility,
  CaslSubject.NotificationDelivery
> {
  /**
   * Initialize NotificationDeliveriesQueryService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   * @param abilityFactory - Factory for role- and membership-aware CASL abilities.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly abilityFactory: CaslAbilityFactory,
  ) {
    super(prisma.notificationDelivery, {
      subject: CaslSubject.NotificationDelivery,
      accessibleWhere: createCaslAccessibleWhere<AppAbility, CaslSubject.NotificationDelivery, CaslAction>({
        action: CaslAction.Read,
      }),
    });
  }

  /**
   * Resolve the resource read ability for the authenticated user.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @returns The CASL ability used for resource queries and DTO projection.
   */
  getReadAbility(user: AuthenticatedUser): Promise<AppAbility> {
    return buildAbility(this.prisma, this.abilityFactory, user);
  }

  /**
   * Convert resource filters and sorting into Query Kit options with stable default ordering.
   *
   * @param query - Validated filters, sorting, pagination, or time-range options.
   * @returns Query Kit options with explicit relation loading and stable default sorting.
   */
  toQueryOptions(query: NotificationDeliveryQueryDto): QueryOptionsMap<NotificationDeliveryTypeMap>['query'] {
    const { search, where, ...options } = query;
    const searchWhere: Prisma.NotificationDeliveryWhereInput | undefined = search
      ? {
          OR: [
            { workflowRun: { workflowName: { contains: search, mode: 'insensitive' } } },
            { pullRequest: { title: { contains: search, mode: 'insensitive' } } },
            { issue: { title: { contains: search, mode: 'insensitive' } } },
            { repository: { name: { contains: search, mode: 'insensitive' } } },
            { notificationChannel: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : undefined;
    return {
      ...options,
      where: searchWhere ? { AND: [where ?? {}, searchWhere] } : where,
      orderBy: query.orderBy ?? [{ createdAt: 'desc' }, { id: 'desc' }],
    };
  }
}
