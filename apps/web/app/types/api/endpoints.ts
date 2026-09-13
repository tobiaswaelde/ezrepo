import type { EndpointDefinition } from '@querry-kit/nuxt/types';

import type {
  CreateNotificationChannel,
  Issue,
  NotificationChannel,
  NotificationDelivery,
  ProviderAccount,
  PullRequest,
  Repository,
  RepositorySyncJob,
  UpdateNotificationChannel,
  User,
  WorkflowRun,
} from './resources';

/** Relative paths for every ezRepo endpoint exposed to the web application. */
export const apiEndpoints = {
  auth: {
    currentUser: '/auth/me',
    password: '/auth/password',
    setup: '/auth/setup',
    setupStatus: '/auth/setup-status',
    signIn: '/auth/signin',
    signOut: '/auth/signout',
  },
  dashboard: {
    awaitingApproval: '/dashboard/awaiting-approval',
    failures: '/dashboard/failures',
    latestRuns: '/dashboard/latest-runs',
    repositories: '/dashboard/repositories',
    summary: '/dashboard/summary',
    trend: '/dashboard/trend',
  },
  health: '/health',
  mcpTokens: '/mcp-tokens',
  notificationChannels: '/notification-channels',
  browserPush: '/browser-push',
  notificationDeliveries: '/notification-deliveries',
  providerAccounts: {
    authenticationOptions: '/provider-accounts/authentication-options',
    authorize: '/provider-accounts/oauth/authorize',
    base: '/provider-accounts',
  },
  repositories: '/repositories',
  repositorySyncJobs: '/jobs/repository-sync',
  settings: { base: '/settings' },
  users: '/users',
  version: '/version/latest',
  workflowRuns: 'workflow-runs',
  issues: 'issues',
  pullRequests: 'pull-requests',
} as const;

/** Resource endpoints that use the shared Query Kit pagination contract. */
export interface Endpoints {
  'notification-channels/query': { create: never; dto: NotificationChannel; update: never };
  'notification-deliveries/query': { create: never; dto: NotificationDelivery; update: never };
  'provider-accounts': {
    create: never;
    dto: ProviderAccount;
    update: never;
  };
  repositories: {
    create: never;
    dto: Repository;
    update: never;
  };
  'jobs/repository-sync': {
    create: never;
    dto: RepositorySyncJob;
    update: never;
  };
  users: {
    create: never;
    dto: User;
    update: never;
  };
  'workflow-runs': {
    create: never;
    dto: WorkflowRun;
    update: never;
  };
  'workflow-runs/needs-attention': {
    create: never;
    dto: WorkflowRun;
    update: never;
  };
  issues: { create: never; dto: Issue; update: never };
  'pull-requests': { create: never; dto: PullRequest; update: never };
}

/** Name of a resource endpoint that uses the shared Query Kit pagination contract. */
export type Endpoint = keyof Endpoints;

type ToQueryKitEndpoint<TEndpoint> = TEndpoint extends {
  create: infer Create;
  dto: infer Item;
  update: infer Update;
}
  ? EndpointDefinition<Item, Create, Update>
  : never;

/** Query Kit-compatible representation of ezRepo's paginated resource endpoints. */
export type QueryKitEndpoints = {
  [TEndpoint in Endpoint]: ToQueryKitEndpoint<Endpoints[TEndpoint]>;
};

/** Notification resource mutation contracts for endpoint-specific API wrappers. */
export interface NotificationEndpointContracts {
  notificationChannels: {
    create: CreateNotificationChannel;
    item: NotificationChannel;
    update: UpdateNotificationChannel;
  };
}
