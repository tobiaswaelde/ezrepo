import { accessibleBy } from '@casl/prisma';
import { Injectable } from '@nestjs/common';
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
import type { PullRequestQueryDto } from './dto/pull-request-query.dto.js';

export interface PullRequestTypeMap extends BaseDelegateTypeMap {
  select: Prisma.PullRequestSelect;
  include: Prisma.PullRequestInclude;
  whereInput: Prisma.PullRequestWhereInput;
  orderByWithRelationInput: Prisma.PullRequestOrderByWithRelationInput;
  whereUniqueInput: Prisma.PullRequestWhereUniqueInput;
  scalarFieldEnum: Prisma.PullRequestScalarFieldEnum;
  createInput: Prisma.PullRequestCreateInput;
  uncheckedCreateInput: Prisma.PullRequestUncheckedCreateInput;
  updateManyMutationInput: Prisma.PullRequestUpdateManyMutationInput;
  uncheckedUpdateManyInput: Prisma.PullRequestUncheckedUpdateManyInput;
  updateInput: Prisma.PullRequestUpdateInput;
  uncheckedUpdateInput: Prisma.PullRequestUncheckedUpdateInput;
  aggregateInputType: Prisma.PullRequestAggregateArgs;
}

/** Query Kit pull-request service that always applies repository-scoped CASL access. */
@Injectable()
export class PullRequestsQueryService extends QueryService<
  typeof PrismaService.prototype.pullRequest,
  PullRequestTypeMap,
  typeof PrismaService.prototype.pullRequest,
  QueryOptionsMap<PullRequestTypeMap>,
  AppAbility,
  CaslSubject.PullRequest
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abilityFactory: CaslAbilityFactory,
  ) {
    super(prisma.pullRequest, {
      subject: CaslSubject.PullRequest,
      accessibleWhere: createCaslAccessibleWhere<AppAbility, CaslSubject.PullRequest, CaslAction>({
        action: CaslAction.Read,
      }),
    });
  }
  async getReadAbility(user: AuthenticatedUser): Promise<AppAbility> {
    const memberships =
      user.role === 'SYSTEM_ADMIN'
        ? []
        : await this.prisma.repositoryMembership.findMany({
            select: { repositoryId: true, role: true },
            where: { userId: user.id },
          });
    return this.abilityFactory.createForUser(user, memberships);
  }
  toQueryOptions(query: PullRequestQueryDto): QueryOptionsMap<PullRequestTypeMap>['query'] {
    const { labels, search, where, ...options } = query;
    const constraints: Prisma.PullRequestWhereInput[] = [where ?? {}];
    if (search)
      constraints.push({
        OR: [{ number: { contains: search } }, { title: { contains: search, mode: 'insensitive' } }],
      });
    for (const label of labels ?? [])
      constraints.push({ labels: { some: { label: { normalizedName: label.trim().toLocaleLowerCase('en-US') } } } });
    return {
      ...options,
      orderBy: query.orderBy ?? [{ providerUpdatedAt: 'desc' }, { id: 'desc' }],
      where: { AND: constraints },
    };
  }
  visibleWhere(ability: AppAbility): Prisma.PullRequestWhereInput {
    return accessibleBy(ability, CaslAction.Read).ofType(
      CaslSubject.PullRequest as never,
    ) as Prisma.PullRequestWhereInput;
  }
}
