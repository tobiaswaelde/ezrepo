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
import type { AuthenticatedUser } from '../auth/types.js';
import type { ProviderAccountQueryDto } from './dto/provider-account-query.dto.js';

/** Prisma delegate type map used by Query Kit for provider-account resources. */
export interface ProviderAccountTypeMap extends BaseDelegateTypeMap {
  select: Prisma.ProviderAccountSelect;
  include: Prisma.ProviderAccountInclude;
  whereInput: Prisma.ProviderAccountWhereInput;
  orderByWithRelationInput: Prisma.ProviderAccountOrderByWithRelationInput;
  whereUniqueInput: Prisma.ProviderAccountWhereUniqueInput;
  scalarFieldEnum: Prisma.ProviderAccountScalarFieldEnum;
  createInput: Prisma.ProviderAccountCreateInput;
  uncheckedCreateInput: Prisma.ProviderAccountUncheckedCreateInput;
  updateManyMutationInput: Prisma.ProviderAccountUpdateManyMutationInput;
  uncheckedUpdateManyInput: Prisma.ProviderAccountUncheckedUpdateManyInput;
  updateInput: Prisma.ProviderAccountUpdateInput;
  uncheckedUpdateInput: Prisma.ProviderAccountUncheckedUpdateInput;
  aggregateInputType: Prisma.ProviderAccountAggregateArgs;
}

/** Query Kit service that exposes provider accounts only to system administrators. */
@Injectable()
export class ProviderAccountsQueryService extends QueryService<
  typeof PrismaService.prototype.providerAccount,
  ProviderAccountTypeMap,
  typeof PrismaService.prototype.providerAccount,
  QueryOptionsMap<ProviderAccountTypeMap>,
  AppAbility,
  CaslSubject.ProviderAccount
> {
  /**
   * Initialize ProviderAccountsQueryService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   * @param abilityFactory - Factory for role- and membership-aware CASL abilities.
   */
  constructor(
    prisma: PrismaService,
    private readonly abilityFactory: CaslAbilityFactory,
  ) {
    super(prisma.providerAccount, {
      subject: CaslSubject.ProviderAccount,
      accessibleWhere: createCaslAccessibleWhere<AppAbility, CaslSubject.ProviderAccount, CaslAction>({
        action: CaslAction.Read,
      }),
    });
  }

  /**
   * Resolve the full provider-account read ability for a system administrator.
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
   * Apply a stable default order when no sort is selected in the table.
   *
   * @param query - Validated filters, sorting, pagination, or time-range options.
   * @returns Query Kit options with explicit relation loading and stable default sorting.
   */
  toQueryOptions(query: ProviderAccountQueryDto): QueryOptionsMap<ProviderAccountTypeMap>['query'] {
    const { search, where, ...options } = query;
    const searchWhere: Prisma.ProviderAccountWhereInput | undefined = search
      ? {
          OR: [
            { displayName: { contains: search, mode: 'insensitive' } },
            { baseUrl: { contains: search, mode: 'insensitive' } },
          ],
        }
      : undefined;

    return {
      ...options,
      where: searchWhere ? { AND: [where ?? {}, searchWhere] } : where,
      orderBy: query.orderBy ?? [{ displayName: 'asc' }, { id: 'asc' }],
    };
  }
}
