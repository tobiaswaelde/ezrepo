import { accessibleBy } from '@casl/prisma';
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
import type { RepositoryQueryDto } from './dto/repository-query.dto.js';

/** Prisma delegate type map used by Query Kit for tracked repositories. */
export interface RepositoryTypeMap extends BaseDelegateTypeMap {
  select: Prisma.RepositorySelect;
  include: Prisma.RepositoryInclude;
  whereInput: Prisma.RepositoryWhereInput;
  orderByWithRelationInput: Prisma.RepositoryOrderByWithRelationInput;
  whereUniqueInput: Prisma.RepositoryWhereUniqueInput;
  scalarFieldEnum: Prisma.RepositoryScalarFieldEnum;
  createInput: Prisma.RepositoryCreateInput;
  uncheckedCreateInput: Prisma.RepositoryUncheckedCreateInput;
  updateManyMutationInput: Prisma.RepositoryUpdateManyMutationInput;
  uncheckedUpdateManyInput: Prisma.RepositoryUncheckedUpdateManyInput;
  updateInput: Prisma.RepositoryUpdateInput;
  uncheckedUpdateInput: Prisma.RepositoryUncheckedUpdateInput;
  aggregateInputType: Prisma.RepositoryAggregateArgs;
}

/** Query Kit service that always combines repository filters with CASL access. */
@Injectable()
export class RepositoriesQueryService extends QueryService<
  typeof PrismaService.prototype.repository,
  RepositoryTypeMap,
  typeof PrismaService.prototype.repository,
  QueryOptionsMap<RepositoryTypeMap>,
  AppAbility,
  CaslSubject.Repository
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abilityFactory: CaslAbilityFactory,
  ) {
    super(prisma.repository, {
      subject: CaslSubject.Repository,
      accessibleWhere: createCaslAccessibleWhere<AppAbility, CaslSubject.Repository, CaslAction>({
        action: CaslAction.Read,
      }),
    });
  }

  /** Resolve a repository read ability from the current user's persisted memberships. */
  async getReadAbility(user: AuthenticatedUser): Promise<AppAbility> {
    const memberships =
      user.role === 'SYSTEM_ADMIN'
        ? []
        : await this.prisma.repositoryMembership.findMany({
            where: { userId: user.id },
            select: { repositoryId: true, role: true },
          });
    return this.abilityFactory.createForUser(user, memberships);
  }

  /** Apply a stable default order when the table has no selected sort. */
  toQueryOptions(query: RepositoryQueryDto): QueryOptionsMap<RepositoryTypeMap>['query'] {
    const { search, where, ...options } = query;
    const searchWhere: Prisma.RepositoryWhereInput | undefined = search
      ? {
          OR: [
            { owner: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
            { url: { contains: search, mode: 'insensitive' } },
          ],
        }
      : undefined;

    return {
      ...options,
      where: searchWhere ? { AND: [where ?? {}, searchWhere] } : where,
      orderBy: query.orderBy ?? [{ owner: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    };
  }

  /** Return the Prisma restriction for repositories readable through the supplied ability. */
  visibleWhere(ability: AppAbility): Prisma.RepositoryWhereInput {
    return accessibleBy(ability, CaslAction.Read).ofType(
      CaslSubject.Repository as never,
    ) as Prisma.RepositoryWhereInput;
  }
}
