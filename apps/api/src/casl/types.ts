import type { Ability, ForcedSubject } from '@casl/ability';

import type { CaslAction } from './casl-action.js';
import type { EzRepoPrismaQuery } from './casl-prisma.js';
import type { CaslSubject } from './casl-subject.js';

/** Repository properties used by repository-scoped ability conditions. */
export interface RepositoryAbilitySubject extends ForcedSubject<CaslSubject.Repository> {
  id: string;
}

/** Workflow-run properties used by repository-scoped ability conditions. */
export interface WorkflowRunAbilitySubject extends ForcedSubject<CaslSubject.WorkflowRun> {
  repositoryId: string;
}

/** Issue properties used by repository-scoped ability conditions. */
export interface IssueAbilitySubject extends ForcedSubject<CaslSubject.Issue> {
  repositoryId: string;
}

/** Pull-request properties used by repository-scoped ability conditions. */
export interface PullRequestAbilitySubject extends ForcedSubject<CaslSubject.PullRequest> {
  repositoryId: string;
}

/** Global notification channel protected by system-level permissions. */
export type NotificationChannelAbilitySubject = ForcedSubject<CaslSubject.NotificationChannel>;

/** Delivery history protected through its workflow rule or direct test channel. */
export type NotificationDeliveryAbilitySubject = ForcedSubject<CaslSubject.NotificationDelivery>;

/** The CASL ability used by ezRepo API policies and query restrictions. */
export type AppAbility = Ability<
  [
    CaslAction,
    (
      | CaslSubject
      | RepositoryAbilitySubject
      | WorkflowRunAbilitySubject
      | IssueAbilitySubject
      | PullRequestAbilitySubject
      | NotificationChannelAbilitySubject
      | NotificationDeliveryAbilitySubject
    ),
  ],
  EzRepoPrismaQuery
>;

/** Repository access resolved from a user's persisted membership. */
export interface RepositoryAccess {
  repositoryId: string;
  role: 'VIEWER' | 'MANAGER';
}
