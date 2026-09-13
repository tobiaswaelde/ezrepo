import { AbilityBuilder } from '@casl/ability';
import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../modules/auth/types.js';
import { CaslAction } from './casl-action.js';
import { createPrismaAbility } from './casl-prisma.js';
import { CaslSubject } from './casl-subject.js';
import type { AppAbility, RepositoryAccess } from './types.js';

/** Builds the authorization ability used to protect repository-scoped data. */
@Injectable()
export class CaslAbilityFactory {
  /**
   * Create an ability for one authenticated user and their repository memberships.
   *
   * A global manager role grants configuration access only where a corresponding
   * manager membership also exists. This keeps system-wide and repository-level
   * authorization scopes explicit.
   */
  createForUser(user: AuthenticatedUser, memberships: RepositoryAccess[]): AppAbility {
    const { build, can } = new AbilityBuilder<AppAbility>(createPrismaAbility);

    if (user.role === 'SYSTEM_ADMIN') {
      can(CaslAction.Manage, CaslSubject.All);
      return build();
    }

    const repositoryIds = memberships.map(({ repositoryId }) => repositoryId);
    if (repositoryIds.length === 0) {
      can(CaslAction.Read, CaslSubject.Repository, { id: { in: [] } });
      can(CaslAction.Read, CaslSubject.WorkflowRun, { repositoryId: { in: [] } });
      can(CaslAction.Read, CaslSubject.Issue, { repositoryId: { in: [] } });
      can(CaslAction.Read, CaslSubject.PullRequest, { repositoryId: { in: [] } });
      can(CaslAction.Read, CaslSubject.NotificationChannel, { repositoryId: { in: [] } });
      can(CaslAction.Read, CaslSubject.NotificationRule, { repositoryId: { in: [] } });
      can(CaslAction.Read, CaslSubject.NotificationDelivery, {
        OR: [
          { notificationRule: { is: { repositoryId: { in: [] } } } },
          { testChannel: { is: { repositoryId: { in: [] } } } },
        ],
      });
      return build();
    }

    can(CaslAction.Read, CaslSubject.Repository, { id: { in: repositoryIds } });
    can(CaslAction.Read, CaslSubject.WorkflowRun, { repositoryId: { in: repositoryIds } });
    can(CaslAction.Read, CaslSubject.Issue, { repositoryId: { in: repositoryIds } });
    can(CaslAction.Read, CaslSubject.PullRequest, { repositoryId: { in: repositoryIds } });
    can(CaslAction.Read, CaslSubject.NotificationChannel, { repositoryId: { in: repositoryIds } });
    can(CaslAction.Read, CaslSubject.NotificationRule, { repositoryId: { in: repositoryIds } });

    if (user.role === 'MANAGER') {
      const managedRepositoryIds = memberships
        .filter(({ role }) => role === 'MANAGER')
        .map(({ repositoryId }) => repositoryId);

      if (managedRepositoryIds.length > 0) {
        can(CaslAction.Update, CaslSubject.Repository, { id: { in: managedRepositoryIds } });
        can(CaslAction.Manage, CaslSubject.NotificationChannel, { repositoryId: { in: managedRepositoryIds } });
        can(CaslAction.Manage, CaslSubject.NotificationRule, { repositoryId: { in: managedRepositoryIds } });
        can(CaslAction.Read, CaslSubject.NotificationDelivery, {
          OR: [
            { notificationRule: { is: { repositoryId: { in: managedRepositoryIds } } } },
            { testChannel: { is: { repositoryId: { in: managedRepositoryIds } } } },
          ],
        });
      }
    }

    return build();
  }
}
