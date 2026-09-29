import { accessibleBy } from '@casl/prisma';
import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  createCaslAccessibleWhere,
  QueryService,
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
import type { SecurityAlertQueryDto } from './dto/security-alert-query.dto.js';

export interface SecurityAlertTypeMap extends BaseDelegateTypeMap {
  select: Prisma.SecurityAlertSelect;
  include: Prisma.SecurityAlertInclude;
  whereInput: Prisma.SecurityAlertWhereInput;
  orderByWithRelationInput: Prisma.SecurityAlertOrderByWithRelationInput;
  whereUniqueInput: Prisma.SecurityAlertWhereUniqueInput;
  scalarFieldEnum: Prisma.SecurityAlertScalarFieldEnum;
  createInput: Prisma.SecurityAlertCreateInput;
  uncheckedCreateInput: Prisma.SecurityAlertUncheckedCreateInput;
  updateManyMutationInput: Prisma.SecurityAlertUpdateManyMutationInput;
  uncheckedUpdateManyInput: Prisma.SecurityAlertUncheckedUpdateManyInput;
  updateInput: Prisma.SecurityAlertUpdateInput;
  uncheckedUpdateInput: Prisma.SecurityAlertUncheckedUpdateInput;
  aggregateInputType: Prisma.SecurityAlertAggregateArgs;
}

/** Query Kit security-alert service with manager-only repository restrictions. */
@Injectable()
export class SecurityAlertsQueryService extends QueryService<
  typeof PrismaService.prototype.securityAlert,
  SecurityAlertTypeMap,
  typeof PrismaService.prototype.securityAlert,
  QueryOptionsMap<SecurityAlertTypeMap>,
  AppAbility,
  CaslSubject.SecurityAlert
> {
  /**
   * Initialize the permission-aware security-alert query service.
   *
   * @param prisma - Database client used by Query Kit.
   * @param abilityFactory - Factory for repository-scoped CASL abilities.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly abilityFactory: CaslAbilityFactory,
  ) {
    super(prisma.securityAlert, {
      subject: CaslSubject.SecurityAlert,
      accessibleWhere: createCaslAccessibleWhere<AppAbility, CaslSubject.SecurityAlert, CaslAction>({
        action: CaslAction.Read,
      }),
    });
  }

  /**
   * Resolve a read ability from manager memberships or system administration.
   *
   * @param user - Authenticated caller.
   * @returns Ability restricted to managed repositories when required.
   * @throws ForbiddenException - When the caller is not a manager or system administrator.
   */
  async getReadAbility(user: AuthenticatedUser): Promise<AppAbility> {
    if (user.role === 'VIEWER') throw new ForbiddenException('Manager access is required.');
    const memberships =
      user.role === 'SYSTEM_ADMIN'
        ? []
        : await this.prisma.repositoryMembership.findMany({
            select: { repositoryId: true, role: true },
            where: { role: 'MANAGER', userId: user.id },
          });
    return this.abilityFactory.createForUser(user, memberships);
  }

  /**
   * Return managed repository IDs, or undefined for unrestricted system administrators.
   *
   * @param user - Authenticated caller.
   * @returns Managed repository IDs, or undefined for a system administrator.
   * @throws ForbiddenException - When the caller is not a manager or system administrator.
   */
  async visibleRepositoryIds(user: AuthenticatedUser): Promise<string[] | undefined> {
    if (user.role === 'SYSTEM_ADMIN') return undefined;
    if (user.role !== 'MANAGER') throw new ForbiddenException('Manager access is required.');
    const memberships = await this.prisma.repositoryMembership.findMany({
      select: { repositoryId: true },
      where: { role: 'MANAGER', userId: user.id },
    });
    return memberships.map(({ repositoryId }) => repositoryId);
  }

  /**
   * Convert validated search and Query Kit fields into stable query options.
   *
   * @param query - Validated security-alert list query.
   * @returns Query Kit options with stable ordering and optional search.
   */
  toQueryOptions(query: SecurityAlertQueryDto): QueryOptionsMap<SecurityAlertTypeMap>['query'] {
    const { search, where, ...options } = query;
    const searchWhere: Prisma.SecurityAlertWhereInput | undefined = search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { packageName: { contains: search, mode: 'insensitive' } },
            { ruleId: { contains: search, mode: 'insensitive' } },
            { secretType: { contains: search, mode: 'insensitive' } },
          ],
        }
      : undefined;
    return {
      ...options,
      orderBy: query.orderBy ?? [{ providerUpdatedAt: 'desc' }, { id: 'desc' }],
      where: searchWhere ? { AND: [where ?? {}, searchWhere] } : where,
    };
  }

  /**
   * Return the Prisma restriction for alerts readable through the supplied ability.
   *
   * @param ability - Caller ability used to derive the database restriction.
   * @returns Prisma where input that enforces repository access.
   */
  visibleWhere(ability: AppAbility): Prisma.SecurityAlertWhereInput {
    return accessibleBy(ability, CaslAction.Read).ofType(
      CaslSubject.SecurityAlert as never,
    ) as Prisma.SecurityAlertWhereInput;
  }
}
