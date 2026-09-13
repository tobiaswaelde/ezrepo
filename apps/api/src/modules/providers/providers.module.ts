import { Module } from '@nestjs/common';

import { CaslModule } from '../../casl/casl.module.js';
import { JobsModule } from '../../jobs/jobs.module.js';
import { SecurityModule } from '../../security/security.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RepositoriesModule } from '../repositories/repositories.module.js';
import { SystemStatusModule } from '../system-status/system-status.module.js';
import { ForgejoActionsAdapter } from './forgejo/forgejo-actions.adapter.js';
import { GiteaActionsAdapter } from './gitea/gitea-actions.adapter.js';
import { GitHubActionsAdapter } from './github/github-actions.adapter.js';
import { GitLabPipelinesAdapter } from './gitlab/gitlab-pipelines.adapter.js';
import { ProviderAccountsQueryService } from './provider-accounts-query.service.js';
import { ProviderAccountsController } from './provider-accounts.controller.js';
import { ProviderAccountsService } from './provider-accounts.service.js';
import { PROVIDER_FETCH } from './provider-adapter.js';
import { ProviderAdapterRegistry } from './provider-adapter.registry.js';
import { ProviderCredentialService } from './provider-credential.service.js';
import { ProviderOAuthStateService } from './provider-oauth-state.service.js';
import { ProviderOAuthController } from './provider-oauth.controller.js';
import { ProviderOAuthService } from './provider-oauth.service.js';
import { RepositoryMetadataService } from './repository-metadata.service.js';
import { RepositoryRefreshController } from './repository-refresh.controller.js';
import { ProviderSyncQueueService } from './sync-queue.service.js';
import { ProviderSyncService } from './sync.service.js';
import { WorkItemSyncService } from './work-item-sync.service.js';

@Module({
  imports: [CaslModule, JobsModule, NotificationsModule, RepositoriesModule, SecurityModule, SystemStatusModule],
  controllers: [ProviderAccountsController, ProviderOAuthController, RepositoryRefreshController],
  providers: [
    {
      provide: PROVIDER_FETCH,
      useValue: fetch,
    },
    ProviderAccountsService,
    ProviderAccountsQueryService,
    ProviderCredentialService,
    ProviderOAuthService,
    ProviderOAuthStateService,
    RepositoryMetadataService,
    GitHubActionsAdapter,
    GitLabPipelinesAdapter,
    ForgejoActionsAdapter,
    GiteaActionsAdapter,
    {
      provide: ProviderAdapterRegistry,
      useFactory: (
        github: GitHubActionsAdapter,
        gitlab: GitLabPipelinesAdapter,
        forgejo: ForgejoActionsAdapter,
        gitea: GiteaActionsAdapter,
      ) => new ProviderAdapterRegistry([github, gitlab, forgejo, gitea]),
      inject: [GitHubActionsAdapter, GitLabPipelinesAdapter, ForgejoActionsAdapter, GiteaActionsAdapter],
    },
    ProviderSyncService,
    ProviderSyncQueueService,
    WorkItemSyncService,
  ],
  exports: [ProviderCredentialService, ProviderAdapterRegistry, ProviderSyncQueueService, ProviderSyncService],
})
export class ProvidersModule {}
