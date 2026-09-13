import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { ENV } from '../../config/env.js';
import { Prisma, type RepositorySyncRequest } from '../../generated/prisma/client.js';
import { JobRunnerService } from '../../jobs/job-runner.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ProviderSyncScope } from './provider-adapter.js';
import { ProviderRequestError } from './provider-request.error.js';
import { providerRetryDecision } from './provider-retry.js';
import { ProviderSyncService } from './sync.service.js';

const webhookDebounceMs = 15_000;
const queueWorkerIntervalMs = 5_000;
const syncLeaseMs = 60 * 60_000;
const candidateBatchSize = 25;

type QueueDatabase = Prisma.TransactionClient | PrismaService;

interface ClaimedSyncRequest {
  attempt: number;
  generation: number;
  id: string;
  leaseToken: string;
  providerAccountId: string;
  repositoryId: string;
  scopes: ProviderSyncScope[];
}

/** Persists, coalesces, claims, and retries repository synchronization requests. */
@Injectable()
export class ProviderSyncQueueService {
  private readonly logger = new Logger(ProviderSyncQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobRunnerService,
    private readonly sync: ProviderSyncService,
  ) {}

  /** Enqueue all enabled repositories for the configured reconciliation interval. */
  @Interval(ENV.SCHEDULER_SYNC_INTERVAL_SECONDS * 1000)
  async scheduleReconciliation(): Promise<void> {
    await this.jobs.run('provider-sync-enqueue', () => this.enqueueEnabledRepositories());
  }

  /** Process all currently due synchronization requests. */
  @Interval(queueWorkerIntervalMs)
  async scheduleQueueProcessing(): Promise<void> {
    await this.jobs.run('provider-sync-worker', () => this.processDueRequests());
  }

  /** Persist immediate requests for every enabled tracked repository. */
  async enqueueEnabledRepositories(): Promise<void> {
    const repositories = await this.prisma.repository.findMany({
      select: { id: true },
      where: { enabled: true, providerAccount: { enabled: true } },
    });
    for (const repository of repositories) await this.enqueueRepository(repository.id, 0);
  }

  /** Persist an immediate synchronization request for one newly tracked or manually selected repository. */
  async enqueueRepositorySync(repositoryId: string, database: QueueDatabase = this.prisma): Promise<void> {
    await this.enqueueRepository(repositoryId, 0, database);
  }

  /** Persist a debounced request for a provider-native repository reference. */
  async enqueueWebhookRepository(
    providerAccountId: string,
    providerRepositoryId: string,
    database: QueueDatabase = this.prisma,
    scopes: ProviderSyncScope[] = ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS'],
  ): Promise<boolean> {
    const repository = await database.repository.findFirst({
      select: { id: true },
      where: {
        enabled: true,
        providerAccountId,
        providerRepositoryId,
        providerAccount: { enabled: true },
      },
    });
    if (!repository) return false;
    await this.enqueueRepository(repository.id, webhookDebounceMs, database, scopes);
    return true;
  }

  /** Claim and execute due requests until no immediately claimable work remains. */
  async processDueRequests(): Promise<void> {
    await this.prisma.repositorySyncRequest.deleteMany({
      where: {
        OR: [{ repository: { enabled: false } }, { repository: { providerAccount: { enabled: false } } }],
      },
    });

    let claimed: ClaimedSyncRequest | null;
    do {
      claimed = await this.claimNextRequest();
      if (claimed) await this.processClaimedRequest(claimed);
    } while (claimed);
  }

  private async enqueueRepository(
    repositoryId: string,
    delayMs: number,
    database: QueueDatabase = this.prisma,
    scopes: ProviderSyncScope[] = ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS'],
  ) {
    const requestedAt = new Date();
    const runAfter = new Date(requestedAt.getTime() + delayMs);
    const id = randomUUID();
    await database.$executeRaw(Prisma.sql`
      INSERT INTO "repository_sync_requests" (
        "id", "createdAt", "updatedAt", "requestedAt", "runAfter", "repositoryId",
        "syncWorkflows", "syncIssues", "syncPullRequests"
      )
      VALUES (
        ${id}::uuid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${requestedAt}, ${runAfter}, ${repositoryId}::uuid,
        ${scopes.includes('WORKFLOWS')}, ${scopes.includes('ISSUES')}, ${scopes.includes('PULL_REQUESTS')}
      )
      ON CONFLICT ("repositoryId") DO UPDATE SET
        "updatedAt" = CURRENT_TIMESTAMP,
        "requestedAt" = EXCLUDED."requestedAt",
        "runAfter" = EXCLUDED."runAfter",
        "generation" = "repository_sync_requests"."generation" + 1,
        "syncWorkflows" = "repository_sync_requests"."syncWorkflows" OR EXCLUDED."syncWorkflows",
        "syncIssues" = "repository_sync_requests"."syncIssues" OR EXCLUDED."syncIssues",
        "syncPullRequests" = "repository_sync_requests"."syncPullRequests" OR EXCLUDED."syncPullRequests",
        "status" = CASE
          WHEN "repository_sync_requests"."status" = 'RUNNING' THEN 'RUNNING'::"RepositorySyncRequestStatus"
          ELSE 'PENDING'::"RepositorySyncRequestStatus"
        END,
        "attempt" = CASE WHEN "repository_sync_requests"."status" = 'RUNNING'
          THEN "repository_sync_requests"."attempt" ELSE 0 END,
        "lastError" = CASE WHEN "repository_sync_requests"."status" = 'RUNNING'
          THEN "repository_sync_requests"."lastError" ELSE NULL END,
        "leaseToken" = CASE WHEN "repository_sync_requests"."status" = 'RUNNING'
          THEN "repository_sync_requests"."leaseToken" ELSE NULL END,
        "leaseExpiresAt" = CASE WHEN "repository_sync_requests"."status" = 'RUNNING'
          THEN "repository_sync_requests"."leaseExpiresAt" ELSE NULL END
    `);
  }

  private async claimNextRequest(): Promise<ClaimedSyncRequest | null> {
    const now = new Date();
    const candidates = await this.prisma.repositorySyncRequest.findMany({
      include: { repository: { select: { providerAccountId: true } } },
      orderBy: [{ runAfter: 'asc' }, { createdAt: 'asc' }],
      take: candidateBatchSize,
      where: {
        OR: [
          { runAfter: { lte: now }, status: 'PENDING' },
          { leaseExpiresAt: { lte: now }, status: 'RUNNING' },
        ],
        repository: {
          enabled: true,
          providerAccount: {
            enabled: true,
            AND: [
              { OR: [{ rateLimitResetAt: null }, { rateLimitResetAt: { lte: now } }] },
              { OR: [{ syncLeaseExpiresAt: null }, { syncLeaseExpiresAt: { lte: now } }] },
            ],
          },
        },
      },
    });

    for (const candidate of candidates) {
      const claimed = await this.claimCandidate(candidate, now);
      if (claimed) return claimed;
    }
    return null;
  }

  private async claimCandidate(
    candidate: RepositorySyncRequest & { repository: { providerAccountId: string } },
    now: Date,
  ): Promise<ClaimedSyncRequest | null> {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + syncLeaseMs);
    return this.prisma.transaction(async (transaction) => {
      const accountClaim = await transaction.providerAccount.updateMany({
        data: { syncLeaseExpiresAt: leaseExpiresAt, syncLeaseToken: leaseToken },
        where: {
          enabled: true,
          id: candidate.repository.providerAccountId,
          OR: [{ syncLeaseExpiresAt: null }, { syncLeaseExpiresAt: { lte: now } }],
          AND: [{ OR: [{ rateLimitResetAt: null }, { rateLimitResetAt: { lte: now } }] }],
        },
      });
      if (accountClaim.count === 0) return null;

      const requestClaim = await transaction.repositorySyncRequest.updateMany({
        data: {
          attempt: { increment: 1 },
          leaseExpiresAt,
          leaseToken,
          status: 'RUNNING',
        },
        where: {
          id: candidate.id,
          OR: [
            { runAfter: { lte: now }, status: 'PENDING' },
            { leaseExpiresAt: { lte: now }, status: 'RUNNING' },
          ],
        },
      });
      if (requestClaim.count === 0) {
        await this.releaseAccountLease(transaction, candidate.repository.providerAccountId, leaseToken);
        return null;
      }

      return {
        attempt: candidate.attempt + 1,
        generation: candidate.generation,
        id: candidate.id,
        leaseToken,
        providerAccountId: candidate.repository.providerAccountId,
        repositoryId: candidate.repositoryId,
        scopes:
          candidate.syncWorkflows === undefined &&
          candidate.syncIssues === undefined &&
          candidate.syncPullRequests === undefined
            ? ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS']
            : [
                ...(candidate.syncWorkflows ? ['WORKFLOWS' as const] : []),
                ...(candidate.syncIssues ? ['ISSUES' as const] : []),
                ...(candidate.syncPullRequests ? ['PULL_REQUESTS' as const] : []),
              ],
      };
    });
  }

  private async processClaimedRequest(request: ClaimedSyncRequest): Promise<void> {
    try {
      if (request.scopes.length === 3) await this.sync.syncRepositoryById(request.repositoryId);
      else await this.sync.syncRepositoryById(request.repositoryId, request.scopes);
      await this.completeRequest(request);
    } catch (error) {
      await this.failRequest(request, error);
    }
  }

  private async completeRequest(request: ClaimedSyncRequest): Promise<void> {
    await this.prisma.transaction(async (transaction) => {
      const current = await transaction.repositorySyncRequest.findUnique({ where: { id: request.id } });
      if (current?.leaseToken === request.leaseToken) {
        if (current.generation > request.generation) {
          await transaction.repositorySyncRequest.update({
            data: {
              attempt: 0,
              lastError: null,
              leaseExpiresAt: null,
              leaseToken: null,
              status: 'PENDING',
            },
            where: { id: request.id },
          });
        } else {
          await transaction.repositorySyncRequest.delete({ where: { id: request.id } });
        }
      }
      await transaction.providerAccount.updateMany({
        data: { rateLimitResetAt: null, syncLeaseExpiresAt: null, syncLeaseToken: null },
        where: { id: request.providerAccountId, syncLeaseToken: request.leaseToken },
      });
    });
  }

  private async failRequest(request: ClaimedSyncRequest, error: unknown): Promise<void> {
    const decision = providerRetryDecision(error, request.attempt);
    await this.prisma.transaction(async (transaction) => {
      const current = await transaction.repositorySyncRequest.findUnique({ where: { id: request.id } });
      if (current?.leaseToken === request.leaseToken) {
        const superseded = current.generation > request.generation;
        await transaction.repositorySyncRequest.update({
          data: superseded
            ? {
                attempt: 0,
                lastError: null,
                leaseExpiresAt: null,
                leaseToken: null,
                status: 'PENDING',
              }
            : {
                lastError: this.failureMessage(error),
                leaseExpiresAt: null,
                leaseToken: null,
                runAfter: decision.runAfter ?? current.runAfter,
                status: decision.retry ? 'PENDING' : 'FAILED',
              },
          where: { id: request.id },
        });
      }
      await transaction.providerAccount.updateMany({
        data: {
          rateLimitResetAt: decision.rateLimitedUntil,
          syncLeaseExpiresAt: null,
          syncLeaseToken: null,
        },
        where: { id: request.providerAccountId, syncLeaseToken: request.leaseToken },
      });
    });
    this.logger.warn(`Queued synchronization failed for repository ${request.repositoryId}.`);
  }

  private async releaseAccountLease(
    database: Prisma.TransactionClient,
    providerAccountId: string,
    leaseToken: string,
  ): Promise<void> {
    await database.providerAccount.updateMany({
      data: { syncLeaseExpiresAt: null, syncLeaseToken: null },
      where: { id: providerAccountId, syncLeaseToken: leaseToken },
    });
  }

  private failureMessage(error: unknown): string {
    if (error instanceof ProviderRequestError && error.rateLimited) return 'Provider rate limit reached.';
    if (error instanceof ProviderRequestError) return `Provider request failed with status ${error.status}.`;
    if (error instanceof TypeError) return 'Provider network request failed.';
    return 'Repository synchronization failed.';
  }
}
