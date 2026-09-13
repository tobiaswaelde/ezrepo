import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { ENV } from '../../config/env.js';
import type { ProviderAccount, Repository } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import type { ProviderWebhookConfigurationDto } from './dto/provider-webhook-configuration.dto.js';
import type { ProviderRepository } from './provider-adapter.js';
import { ProviderAdapterRegistry } from './provider-adapter.registry.js';
import { ProviderCredentialService } from './provider-credential.service.js';
import { ProviderSyncQueueService } from './sync-queue.service.js';

/** Admin-only persistence service for ezRepo provider accounts. */
@Injectable()
export class ProviderAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: ProviderCredentialService,
    private readonly adapters: ProviderAdapterRegistry,
    private readonly syncQueue: ProviderSyncQueueService,
  ) {}

  async list(user: AuthenticatedUser) {
    this.assertAdmin(user);
    return this.prisma.providerAccount.findMany({ orderBy: { displayName: 'asc' } });
  }

  /**
   * Return safe webhook setup metadata for every configured provider account.
   *
   * @param user System administrator requesting webhook configuration metadata.
   * @returns Provider callback URLs, configuration state, and last accepted deliveries without any secrets.
   */
  async listWebhookConfigurations(user: AuthenticatedUser): Promise<ProviderWebhookConfigurationDto[]> {
    this.assertAdmin(user);
    const accounts = await this.prisma.providerAccount.findMany({
      orderBy: { displayName: 'asc' },
      select: {
        encryptedWebhookSecret: true,
        id: true,
        providerType: true,
        webhookDeliveries: {
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
          take: 1,
        },
      },
    });

    return accounts.map((account) => ({
      callbackUrl: new URL(
        `/api/webhooks/${account.providerType.toLocaleLowerCase('en-US')}/${account.id}`,
        ENV.PUBLIC_URL,
      ).toString(),
      configured: account.encryptedWebhookSecret !== null,
      lastDeliveryAt: account.webhookDeliveries[0]?.createdAt ?? null,
      providerAccountId: account.id,
      providerType: account.providerType,
    }));
  }
  /**
   * Persists a provider token received from a completed OAuth authorization.
   *
   * @param user The administrator that authorized the account.
   * @param input Provider account metadata and the returned OAuth token.
   * @returns The encrypted provider account record.
   */
  async createFromOAuth(
    user: AuthenticatedUser,
    input: {
      providerType: 'GITHUB' | 'GITLAB' | 'FORGEJO';
      displayName: string;
      baseUrl?: string;
      accessToken: string;
    },
  ) {
    return this.create(user, { ...input, enabled: true });
  }

  /**
   * Persists a provider account that uses a manually supplied personal access token.
   *
   * @param user The administrator adding the provider account.
   * @param input Provider account metadata and its write-only token.
   * @returns The encrypted provider account record.
   */
  async create(
    user: AuthenticatedUser,
    input: {
      providerType: 'GITHUB' | 'GITLAB' | 'FORGEJO' | 'GITEA';
      displayName: string;
      baseUrl?: string;
      enabled?: boolean;
      accessToken: string;
      webhookSecret?: string;
    },
  ) {
    this.assertAdmin(user);
    if (input.providerType === 'GITEA' && !input.baseUrl) {
      throw new BadRequestException('A Gitea base URL is required.');
    }
    await this.validateCredentials(input);
    return this.prisma.providerAccount.create({
      data: {
        providerType: input.providerType,
        displayName: input.displayName,
        baseUrl: input.baseUrl ?? null,
        enabled: input.enabled ?? true,
        encryptedAccessToken: this.credentials.encrypt(input.accessToken),
        encryptedWebhookSecret: input.webhookSecret ? this.credentials.encrypt(input.webhookSecret) : null,
      },
    });
  }
  async update(
    user: AuthenticatedUser,
    id: string,
    input: {
      displayName?: string;
      baseUrl?: string | null;
      enabled?: boolean;
      accessToken?: string;
      webhookSecret?: string;
      clearWebhookSecret?: boolean;
    },
  ) {
    this.assertAdmin(user);
    const account = await this.require(id);
    if (account.providerType === 'GITEA' && input.baseUrl === null) {
      throw new BadRequestException('A Gitea base URL is required.');
    }
    return this.prisma.providerAccount.update({
      where: { id },
      data: {
        displayName: input.displayName,
        baseUrl: input.baseUrl,
        enabled: input.enabled,
        encryptedAccessToken: input.accessToken ? this.credentials.encrypt(input.accessToken) : undefined,
        encryptedWebhookSecret: input.clearWebhookSecret
          ? null
          : input.webhookSecret
            ? this.credentials.encrypt(input.webhookSecret)
            : undefined,
      },
    });
  }
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    this.assertAdmin(user);
    await this.require(id);
    await this.prisma.providerAccount.delete({ where: { id } });
  }

  /**
   * Discover the repositories accessible through one enabled provider account.
   *
   * @param user System administrator requesting the provider's read-only repository list.
   * @param providerAccountId Configured provider account to inspect.
   * @returns Provider repositories and whether each is already tracked by ezRepo.
   */
  async listAvailableRepositories(
    user: AuthenticatedUser,
    providerAccountId: string,
  ): Promise<Array<ProviderRepository & { tracked: boolean }>> {
    this.assertAdmin(user);
    const account = await this.requireEnabled(providerAccountId);
    const [repositories, trackedRepositories] = await Promise.all([
      this.discoverRepositories(account),
      this.prisma.repository.findMany({
        where: { providerAccountId },
        select: { providerRepositoryId: true },
      }),
    ]);
    const trackedIds = new Set(trackedRepositories.map(({ providerRepositoryId }) => providerRepositoryId));

    return repositories.map((repository) => ({
      ...repository,
      tracked: trackedIds.has(repository.providerRepositoryId),
    }));
  }

  /**
   * Add a repository selected from the provider's current read-only discovery result.
   *
   * @param user System administrator adding the tracked repository.
   * @param providerAccountId Configured provider account that owns the repository.
   * @param providerRepositoryId Provider-native repository identifier selected by the administrator.
   * @returns The persisted tracked repository.
   * @throws {NotFoundException} When the selected repository is not accessible through the provider account.
   */
  async addRepository(
    user: AuthenticatedUser,
    providerAccountId: string,
    providerRepositoryId: string,
  ): Promise<Repository> {
    this.assertAdmin(user);
    const account = await this.requireEnabled(providerAccountId);
    const repository = (await this.discoverRepositories(account)).find(
      (candidate) => candidate.providerRepositoryId === providerRepositoryId,
    );
    if (!repository) throw new NotFoundException('Provider repository not found.');

    const trackedRepository = await this.prisma.repository.create({
      data: {
        name: repository.name,
        owner: repository.owner,
        providerAccountId,
        providerRepositoryId: repository.providerRepositoryId,
        url: repository.url,
      },
    });
    await this.syncQueue.enqueueRepositorySync(trackedRepository.id);
    return trackedRepository;
  }

  /** Ensures that a request belongs to a system administrator. */
  assertAdmin(user: AuthenticatedUser): void {
    if (user.role !== 'SYSTEM_ADMIN') throw new ForbiddenException('System administrator access is required.');
  }
  private async require(id: string) {
    const account = await this.prisma.providerAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Provider account not found.');
    return account;
  }

  /** Load a provider account that may safely be used for outbound read-only requests. */
  private async requireEnabled(id: string): Promise<ProviderAccount> {
    const account = await this.require(id);
    if (!account.enabled) throw new BadRequestException('Provider account is disabled.');
    return account;
  }

  /** Discover repositories without exposing the provider credential outside this service. */
  private async discoverRepositories(account: ProviderAccount): Promise<ProviderRepository[]> {
    try {
      return await this.adapters.get(account.providerType).listRepositories({
        accessToken: this.credentials.decrypt(account.encryptedAccessToken),
        baseUrl: account.baseUrl,
        providerAccountId: account.id,
      });
    } catch {
      throw new BadRequestException('Provider repositories could not be loaded.');
    }
  }

  /** Verify a candidate's credentials through the provider's read-only account endpoint. */
  private async validateCredentials(input: {
    providerType: 'GITHUB' | 'GITLAB' | 'FORGEJO' | 'GITEA';
    baseUrl?: string;
    accessToken: string;
  }): Promise<void> {
    try {
      const validation = await this.adapters.get(input.providerType).validateAccount({
        accessToken: input.accessToken,
        baseUrl: input.baseUrl ?? null,
        providerAccountId: 'unpersisted-provider-account',
      });
      if (!validation.valid) throw new Error('Provider rejected the credentials.');
    } catch {
      throw new BadRequestException('Provider credentials could not be validated.');
    }
  }
}
