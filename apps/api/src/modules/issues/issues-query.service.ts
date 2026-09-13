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
import type { IssueQueryDto } from './dto/issue-query.dto.js';

export interface IssueTypeMap extends BaseDelegateTypeMap {
  select: Prisma.IssueSelect;
  include: Prisma.IssueInclude;
  whereInput: Prisma.IssueWhereInput;
  orderByWithRelationInput: Prisma.IssueOrderByWithRelationInput;
  whereUniqueInput: Prisma.IssueWhereUniqueInput;
  scalarFieldEnum: Prisma.IssueScalarFieldEnum;
  createInput: Prisma.IssueCreateInput;
  uncheckedCreateInput: Prisma.IssueUncheckedCreateInput;
  updateManyMutationInput: Prisma.IssueUpdateManyMutationInput;
  uncheckedUpdateManyInput: Prisma.IssueUncheckedUpdateManyInput;
  updateInput: Prisma.IssueUpdateInput;
  uncheckedUpdateInput: Prisma.IssueUncheckedUpdateInput;
  aggregateInputType: Prisma.IssueAggregateArgs;
}

/** Query Kit issue service that always applies repository-scoped CASL access. */
@Injectable()
export class IssuesQueryService extends QueryService<
  typeof PrismaService.prototype.issue,
  IssueTypeMap,
  typeof PrismaService.prototype.issue,
  QueryOptionsMap<IssueTypeMap>,
  AppAbility,
  CaslSubject.Issue
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abilityFactory: CaslAbilityFactory,
  ) {
    super(prisma.issue, {
      subject: CaslSubject.Issue,
      accessibleWhere: createCaslAccessibleWhere<AppAbility, CaslSubject.Issue, CaslAction>({
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

  toQueryOptions(query: IssueQueryDto): QueryOptionsMap<IssueTypeMap>['query'] {
    const { labels, search, where, ...options } = query;
    const constraints: Prisma.IssueWhereInput[] = [where ?? {}];
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

  visibleWhere(ability: AppAbility): Prisma.IssueWhereInput {
    return accessibleBy(ability, CaslAction.Read).ofType(CaslSubject.Issue as never) as Prisma.IssueWhereInput;
  }
}
