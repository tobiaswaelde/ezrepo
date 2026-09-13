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
import type {
  NotificationChannelQueryDto,
  NotificationDeliveryQueryDto,
  NotificationRuleQueryDto,
} from './dto/notification-query.dto.js';

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

export interface NotificationRuleTypeMap extends NotificationTypeMapBase {
  select: Prisma.NotificationRuleSelect;
  include: Prisma.NotificationRuleInclude;
  whereInput: Prisma.NotificationRuleWhereInput;
  orderByWithRelationInput: Prisma.NotificationRuleOrderByWithRelationInput;
  whereUniqueInput: Prisma.NotificationRuleWhereUniqueInput;
  scalarFieldEnum: Prisma.NotificationRuleScalarFieldEnum;
  aggregateInputType: Prisma.NotificationRuleAggregateArgs;
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

/** Query Kit adapter for repository-scoped notification channels. */
@Injectable()
export class NotificationChannelsQueryService extends QueryService<
  typeof PrismaService.prototype.notificationChannel,
  NotificationChannelTypeMap,
  typeof PrismaService.prototype.notificationChannel,
  QueryOptionsMap<NotificationChannelTypeMap>,
  AppAbility,
  CaslSubject.NotificationChannel
> {
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

  getReadAbility(user: AuthenticatedUser): Promise<AppAbility> {
    return buildAbility(this.prisma, this.abilityFactory, user);
  }

  toQueryOptions(query: NotificationChannelQueryDto): QueryOptionsMap<NotificationChannelTypeMap>['query'] {
    const { search, where, ...options } = query;
    const searchWhere: Prisma.NotificationChannelWhereInput | undefined = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { repository: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : undefined;
    return {
      ...options,
      where: searchWhere ? { AND: [where ?? {}, searchWhere] } : where,
      orderBy: query.orderBy ?? [{ name: 'asc' }, { id: 'asc' }],
    };
  }
}

/** Query Kit adapter for repository-scoped notification rules. */
@Injectable()
export class NotificationRulesQueryService extends QueryService<
  typeof PrismaService.prototype.notificationRule,
  NotificationRuleTypeMap,
  typeof PrismaService.prototype.notificationRule,
  QueryOptionsMap<NotificationRuleTypeMap>,
  AppAbility,
  CaslSubject.NotificationRule
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abilityFactory: CaslAbilityFactory,
  ) {
    super(prisma.notificationRule, {
      subject: CaslSubject.NotificationRule,
      accessibleWhere: createCaslAccessibleWhere<AppAbility, CaslSubject.NotificationRule, CaslAction>({
        action: CaslAction.Read,
      }),
    });
  }

  getReadAbility(user: AuthenticatedUser): Promise<AppAbility> {
    return buildAbility(this.prisma, this.abilityFactory, user);
  }

  toQueryOptions(query: NotificationRuleQueryDto): QueryOptionsMap<NotificationRuleTypeMap>['query'] {
    const { search, where, ...options } = query;
    const searchWhere: Prisma.NotificationRuleWhereInput | undefined = search
      ? {
          OR: [
            { workflowPattern: { contains: search, mode: 'insensitive' } },
            { repository: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : undefined;
    return {
      ...options,
      where: searchWhere ? { AND: [where ?? {}, searchWhere] } : where,
      orderBy: query.orderBy ?? [{ workflowPattern: 'asc' }, { id: 'asc' }],
    };
  }
}

/** Query Kit adapter for authorized workflow and test delivery history. */
@Injectable()
export class NotificationDeliveriesQueryService extends QueryService<
  typeof PrismaService.prototype.notificationDelivery,
  NotificationDeliveryTypeMap,
  typeof PrismaService.prototype.notificationDelivery,
  QueryOptionsMap<NotificationDeliveryTypeMap>,
  AppAbility,
  CaslSubject.NotificationDelivery
> {
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

  getReadAbility(user: AuthenticatedUser): Promise<AppAbility> {
    return buildAbility(this.prisma, this.abilityFactory, user);
  }

  toQueryOptions(query: NotificationDeliveryQueryDto): QueryOptionsMap<NotificationDeliveryTypeMap>['query'] {
    const { search, where, ...options } = query;
    const searchWhere: Prisma.NotificationDeliveryWhereInput | undefined = search
      ? {
          OR: [
            { workflowRun: { workflowName: { contains: search, mode: 'insensitive' } } },
            { notificationRule: { repository: { name: { contains: search, mode: 'insensitive' } } } },
            { testChannel: { name: { contains: search, mode: 'insensitive' } } },
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
