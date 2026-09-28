import { Injectable } from '@nestjs/common';

import type { ProviderType } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Last known synchronization state for one configured provider account. */
export interface ProviderAccountHealth {
  displayName: string;
  enabled: boolean;
  id: string;
  lastSyncAt: Date | null;
  providerType: ProviderType;
  syncStatus: 'disabled' | 'failed' | 'healthy' | 'unknown';
}

/** Health information for the API process, database, and configured providers. */
export interface HealthResponse {
  api: 'ok';
  database: 'error' | 'ok';
  providers: ProviderAccountHealth[];
  status: 'degraded' | 'ok';
}

/** Reports locally available health information without performing provider requests. */
@Injectable()
export class HealthService {
  /**
   * Initialize HealthService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Collect the current database health and last persisted provider synchronization state.
   *
   * @returns A health payload that never exposes credentials or contacts providers.
   */
  async getHealth(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const providers = await this.prisma.providerAccount.findMany({
        select: {
          displayName: true,
          enabled: true,
          id: true,
          lastSyncAt: true,
          lastSyncError: true,
          providerType: true,
        },
        orderBy: { displayName: 'asc' },
      });
      const providerHealth = providers.map((provider) => this.toProviderHealth(provider));

      return {
        api: 'ok',
        database: 'ok',
        providers: providerHealth,
        status: providerHealth.some((provider) => provider.syncStatus === 'failed') ? 'degraded' : 'ok',
      };
    } catch {
      return {
        api: 'ok',
        database: 'error',
        providers: [],
        status: 'degraded',
      };
    }
  }

  /**
   * Project provider synchronization metadata into a credential-free health response.
   *
   * @param provider - Provider identity or persisted metadata associated with the operation.
   * @returns Provider health metadata without credentials.
   */
  private toProviderHealth(provider: {
    displayName: string;
    enabled: boolean;
    id: string;
    lastSyncAt: Date | null;
    lastSyncError: string | null;
    providerType: ProviderType;
  }): ProviderAccountHealth {
    return {
      displayName: provider.displayName,
      enabled: provider.enabled,
      id: provider.id,
      lastSyncAt: provider.lastSyncAt,
      providerType: provider.providerType,
      syncStatus: !provider.enabled
        ? 'disabled'
        : provider.lastSyncError
          ? 'failed'
          : provider.lastSyncAt
            ? 'healthy'
            : 'unknown',
    };
  }
}
