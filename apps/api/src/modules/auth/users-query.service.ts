import { ForbiddenException, Injectable } from '@nestjs/common';
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
import type { UserQueryDto } from './dto/user-query.dto.js';
import type { AuthenticatedUser } from './types.js';

/** Prisma delegate type map used by Query Kit for system users. */
export interface UserTypeMap extends BaseDelegateTypeMap {
  select: Prisma.UserSelect;
  include: Prisma.UserInclude;
  whereInput: Prisma.UserWhereInput;
  orderByWithRelationInput: Prisma.UserOrderByWithRelationInput;
  whereUniqueInput: Prisma.UserWhereUniqueInput;
  scalarFieldEnum: Prisma.UserScalarFieldEnum;
  createInput: Prisma.UserCreateInput;
  uncheckedCreateInput: Prisma.UserUncheckedCreateInput;
  updateManyMutationInput: Prisma.UserUpdateManyMutationInput;
  uncheckedUpdateManyInput: Prisma.UserUncheckedUpdateManyInput;
  updateInput: Prisma.UserUpdateInput;
  uncheckedUpdateInput: Prisma.UserUncheckedUpdateInput;
  aggregateInputType: Prisma.UserAggregateArgs;
}

/** Query Kit service that exposes users only to system administrators. */
@Injectable()
export class UsersQueryService extends QueryService<
  typeof PrismaService.prototype.user,
  UserTypeMap,
  typeof PrismaService.prototype.user,
  QueryOptionsMap<UserTypeMap>,
  AppAbility,
  CaslSubject.User
> {
  /**
   * Initialize UsersQueryService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   * @param abilityFactory - Factory for role- and membership-aware CASL abilities.
   */
  constructor(
    prisma: PrismaService,
    private readonly abilityFactory: CaslAbilityFactory,
  ) {
    super(prisma.user, {
      subject: CaslSubject.User,
      accessibleWhere: createCaslAccessibleWhere<AppAbility, CaslSubject.User, CaslAction>({ action: CaslAction.Read }),
    });
  }

  /**
   * Resolve the full user read ability for a system administrator.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @returns The CASL ability used for resource queries and DTO projection.
   * @throws ForbiddenException - System administrator access is required.
   */
  getReadAbility(user: AuthenticatedUser): AppAbility {
    if (user.role !== 'SYSTEM_ADMIN') throw new ForbiddenException('System administrator access is required.');
    return this.abilityFactory.createForUser(user, []);
  }

  /**
   * Apply a stable default order when the table has no selected sort.
   *
   * @param query - Validated filters, sorting, pagination, or time-range options.
   * @returns Query Kit options with explicit relation loading and stable default sorting.
   */
  toQueryOptions(query: UserQueryDto): QueryOptionsMap<UserTypeMap>['query'] {
    return { ...query, orderBy: query.orderBy ?? [{ username: 'asc' }, { id: 'asc' }] };
  }
}
