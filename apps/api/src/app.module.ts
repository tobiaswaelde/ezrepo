import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { CaslModule } from './casl/casl.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IssuesModule } from './modules/issues/issues.module.js';
import { McpModule } from './modules/mcp/mcp.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { ProvidersModule } from './modules/providers/providers.module.js';
import { PullRequestsModule } from './modules/pull-requests/pull-requests.module.js';
import { RepositoriesModule } from './modules/repositories/repositories.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { VersionModule } from './modules/version/version.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { WorkflowRunsModule } from './modules/workflow-runs/workflow-runs.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ limit: 120, ttl: 60_000 }]),
    PrismaModule,
    CaslModule,
    McpModule,
    IssuesModule,
    NotificationsModule,
    RepositoriesModule,
    SettingsModule,
    ProvidersModule,
    PullRequestsModule,
    JobsModule,
    AuthModule,
    DashboardModule,
    HealthModule,
    WebhooksModule,
    VersionModule,
    WorkflowRunsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
