import type { AxiosResponse } from 'axios';

import { apiEndpoints } from '~/types/api/endpoints';
import type {
  ApplicationSettings,
  CreatedMcpAccessToken,
  CreateMcpAccessToken,
  CreateNotificationChannel,
  CreateNotificationRule,
  CreateProviderAccount,
  DashboardPeriodQuery,
  DashboardSummary,
  DashboardWorkflowRun,
  HealthResponse,
  Issue,
  IssueSummary,
  McpAccessToken,
  NotificationChannel,
  NotificationDelivery,
  NotificationRule,
  PaginatedResource,
  ProviderAccount,
  ProviderAuthenticationOptions,
  ProviderOAuthAuthorization,
  ProviderRepository,
  PullRequest,
  PullRequestSummary,
  Repository,
  RepositoryHealth,
  RepositoryMembership,
  RepositorySyncJobSummary,
  StartProviderOAuth,
  UpdateApplicationSettings,
  UpdateNotificationChannel,
  UpdateNotificationRule,
  UpdateProviderAccount,
  User,
  WorkflowFilter,
  WorkflowRunTrendBucket,
  WorkflowRunTrendQuery,
  WorkItemFilterOptions,
} from '~/types/api/resources';
import { useApi } from './api';

/** Provide typed methods for ezRepo's non-Query-Kit API endpoints. */
export function useEzRepoApi() {
  const api = useApi();

  return {
    dashboard: {
      getAwaitingApproval: (): Promise<AxiosResponse<DashboardWorkflowRun[]>> =>
        api.get(apiEndpoints.dashboard.awaitingApproval),
      getFailures: (): Promise<AxiosResponse<DashboardWorkflowRun[]>> => api.get(apiEndpoints.dashboard.failures),
      getLatestRuns: (): Promise<AxiosResponse<DashboardWorkflowRun[]>> => api.get(apiEndpoints.dashboard.latestRuns),
      getRepositoryHealth: (query: DashboardPeriodQuery): Promise<AxiosResponse<RepositoryHealth[]>> =>
        api.get(apiEndpoints.dashboard.repositories, { params: query }),
      getSummary: (query: DashboardPeriodQuery): Promise<AxiosResponse<DashboardSummary>> =>
        api.get(apiEndpoints.dashboard.summary, { params: query }),
      getTrend: (query: WorkflowRunTrendQuery): Promise<AxiosResponse<WorkflowRunTrendBucket[]>> =>
        api.get(apiEndpoints.dashboard.trend, { params: query }),
    },
    health: (): Promise<AxiosResponse<HealthResponse>> => api.get(apiEndpoints.health),
    issues: {
      filterOptions: (): Promise<AxiosResponse<WorkItemFilterOptions>> =>
        api.get(`${apiEndpoints.issues}/filter-options`),
      get: (id: string): Promise<AxiosResponse<Issue>> => api.get(`${apiEndpoints.issues}/${id}`),
      summary: (): Promise<AxiosResponse<IssueSummary>> => api.get(`${apiEndpoints.issues}/summary`),
    },
    jobs: {
      start: (repositoryId: string): Promise<AxiosResponse<{ queuedCount: number }>> =>
        api.post(`${apiEndpoints.repositorySyncJobs}/${repositoryId}/run`),
      startAll: (): Promise<AxiosResponse<{ queuedCount: number }>> =>
        api.post(`${apiEndpoints.repositorySyncJobs}/run`),
      summary: (): Promise<AxiosResponse<RepositorySyncJobSummary>> =>
        api.get(`${apiEndpoints.repositorySyncJobs}/summary`),
    },
    mcpTokens: {
      create: (input: CreateMcpAccessToken): Promise<AxiosResponse<CreatedMcpAccessToken>> =>
        api.post(apiEndpoints.mcpTokens, input),
      list: (userId?: string): Promise<AxiosResponse<McpAccessToken[]>> =>
        api.get(apiEndpoints.mcpTokens, { params: { userId } }),
      revoke: (id: string): Promise<AxiosResponse<void>> => api.delete(`${apiEndpoints.mcpTokens}/${id}`),
    },
    notificationChannels: {
      create: (input: CreateNotificationChannel): Promise<AxiosResponse<NotificationChannel>> =>
        api.post(apiEndpoints.notificationChannels, input),
      delete: (id: string): Promise<AxiosResponse<void>> => api.delete(`${apiEndpoints.notificationChannels}/${id}`),
      list: (repositoryId?: string): Promise<AxiosResponse<NotificationChannel[]>> =>
        api.get(apiEndpoints.notificationChannels, { params: { repositoryId } }),
      update: (id: string, input: UpdateNotificationChannel): Promise<AxiosResponse<NotificationChannel>> =>
        api.patch(`${apiEndpoints.notificationChannels}/${id}`, input),
    },
    notificationDeliveries: {
      list: (repositoryId?: string): Promise<AxiosResponse<NotificationDelivery[]>> =>
        api.get(apiEndpoints.notificationDeliveries, { params: { repositoryId } }),
    },
    notificationRules: {
      create: (input: CreateNotificationRule): Promise<AxiosResponse<NotificationRule>> =>
        api.post(apiEndpoints.notificationRules, input),
      delete: (id: string): Promise<AxiosResponse<void>> => api.delete(`${apiEndpoints.notificationRules}/${id}`),
      list: (repositoryId?: string): Promise<AxiosResponse<NotificationRule[]>> =>
        api.get(apiEndpoints.notificationRules, { params: { repositoryId } }),
      update: (id: string, input: UpdateNotificationRule): Promise<AxiosResponse<NotificationRule>> =>
        api.patch(`${apiEndpoints.notificationRules}/${id}`, input),
    },
    providerAccounts: {
      authorize: (input: StartProviderOAuth): Promise<AxiosResponse<ProviderOAuthAuthorization>> =>
        api.post(apiEndpoints.providerAccounts.authorize, input),
      authenticationOptions: (): Promise<AxiosResponse<ProviderAuthenticationOptions>> =>
        api.get(apiEndpoints.providerAccounts.authenticationOptions),
      create: (input: CreateProviderAccount): Promise<AxiosResponse<ProviderAccount>> =>
        api.post(apiEndpoints.providerAccounts.base, input),
      delete: (id: string): Promise<AxiosResponse<void>> => api.delete(`${apiEndpoints.providerAccounts.base}/${id}`),
      list: (): Promise<AxiosResponse<PaginatedResource<ProviderAccount>>> =>
        api.get(apiEndpoints.providerAccounts.base, {
          params: { fields: 'id,displayName,providerType,enabled', page: 1, perPage: 100 },
        }),
      listRepositories: (id: string): Promise<AxiosResponse<ProviderRepository[]>> =>
        api.get(`${apiEndpoints.providerAccounts.base}/${id}/repositories`),
      addRepository: (id: string, providerRepositoryId: string): Promise<AxiosResponse<Repository>> =>
        api.post(`${apiEndpoints.providerAccounts.base}/${id}/repositories`, { providerRepositoryId }),
      update: (id: string, input: UpdateProviderAccount): Promise<AxiosResponse<ProviderAccount>> =>
        api.patch(`${apiEndpoints.providerAccounts.base}/${id}`, input),
    },
    pullRequests: {
      filterOptions: (): Promise<AxiosResponse<WorkItemFilterOptions>> =>
        api.get(`${apiEndpoints.pullRequests}/filter-options`),
      get: (id: string): Promise<AxiosResponse<PullRequest>> => api.get(`${apiEndpoints.pullRequests}/${id}`),
      summary: (): Promise<AxiosResponse<PullRequestSummary>> => api.get(`${apiEndpoints.pullRequests}/summary`),
    },
    repositories: {
      createWorkflowFilter: (
        id: string,
        input: Pick<WorkflowFilter, 'mode' | 'pattern'>,
      ): Promise<AxiosResponse<WorkflowFilter>> =>
        api.post(`${apiEndpoints.repositories}/${id}/workflow-filters`, input),
      deleteMembership: (id: string, userId: string): Promise<AxiosResponse<void>> =>
        api.delete(`${apiEndpoints.repositories}/${id}/memberships/${userId}`),
      deleteWorkflowFilter: (id: string, filterId: string): Promise<AxiosResponse<void>> =>
        api.delete(`${apiEndpoints.repositories}/${id}/workflow-filters/${filterId}`),
      get: (id: string): Promise<AxiosResponse<Repository>> => api.get(`${apiEndpoints.repositories}/${id}`),
      list: (page: number): Promise<AxiosResponse<PaginatedResource<Pick<Repository, 'id' | 'name' | 'owner'>>>> =>
        api.get(apiEndpoints.repositories, {
          params: {
            fields: 'id,name,owner',
            orderBy: JSON.stringify([{ owner: 'asc' }, { name: 'asc' }, { id: 'asc' }]),
            page,
            perPage: 1_000,
          },
        }),
      listMemberships: (id: string): Promise<AxiosResponse<RepositoryMembership[]>> =>
        api.get(`${apiEndpoints.repositories}/${id}/memberships`),
      listWorkflowFilters: (id: string): Promise<AxiosResponse<WorkflowFilter[]>> =>
        api.get(`${apiEndpoints.repositories}/${id}/workflow-filters`),
      refresh: (id: string): Promise<AxiosResponse<Repository>> =>
        api.post(`${apiEndpoints.repositories}/${id}/refresh`),
      sync: (id: string): Promise<AxiosResponse<void>> => api.post(`${apiEndpoints.repositories}/${id}/sync`),
      update: (
        id: string,
        input: { enabled: boolean; workflowRunRetentionDays: number | null },
      ): Promise<AxiosResponse<void>> => api.patch(`${apiEndpoints.repositories}/${id}`, input),
      upsertMembership: (
        id: string,
        userId: string,
        input: Pick<RepositoryMembership, 'role'>,
      ): Promise<AxiosResponse<RepositoryMembership>> =>
        api.put(`${apiEndpoints.repositories}/${id}/memberships/${userId}`, input),
    },
    settings: {
      get: (): Promise<AxiosResponse<ApplicationSettings>> => api.get(apiEndpoints.settings.base),
      update: (input: UpdateApplicationSettings): Promise<AxiosResponse<ApplicationSettings>> =>
        api.patch(apiEndpoints.settings.base, input),
    },
    users: {
      delete: (id: string): Promise<AxiosResponse<void>> => api.delete(`${apiEndpoints.users}/${id}`),
      list: (): Promise<AxiosResponse<PaginatedResource<User>>> =>
        api.get(apiEndpoints.users, {
          params: {
            fields: 'id,username,firstName,lastName,role,avatarUpdatedAt,createdAt,updatedAt',
            page: 1,
            perPage: 100,
          },
        }),
    },
    version: (): Promise<AxiosResponse<{ latest: string | null }>> => api.get(apiEndpoints.version),
  };
}
