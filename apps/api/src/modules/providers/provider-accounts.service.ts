import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { ProviderAccount, Repository } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import type { ProviderRepository } from './provider-adapter.js';
import { ProviderAdapterRegistry } from './provider-adapter.registry.js';
import { ProviderCredentialService } from './provider-credential.service.js';
import { ProviderSyncQueueService } from './sync-queue.service.js';

/** Admin-only persistence service for ezRepo provider accounts. */
@Injectable()
export class ProviderAccountsService {
  /**
   * Initialize ProviderAccountsService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   * @param credentials - Service encrypting and decrypting persisted credentials.
   * @param adapters - Registry resolving the read-only adapter for each provider type.
   * @param syncQueue - Durable queue for repository synchronization requests.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: ProviderCredentialService,
    private readonly adapters: ProviderAdapterRegistry,
    private readonly syncQueue: ProviderSyncQueueService,
  ) {}

  /**
   * List persisted provider accounts for system administrators.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @returns Persisted account records ordered by display name, including encrypted credentials for server-side use.
   * @throws ForbiddenException - System administrator access is required.
   */
  async list(user: AuthenticatedUser) {
    this.assertAdmin(user);
    return this.prisma.providerAccount.findMany({ orderBy: { displayName: 'asc' } });
  }

  /**
   * Persists a provider token received from a completed OAuth authorization.
   *
   * @param user - The administrator that authorized the account.
   * @param input - Provider account metadata and the returned OAuth token.
   * @returns The encrypted provider account record.
   * @throws BadRequestException - A Gitea base URL is required.
   * @throws ForbiddenException - System administrator access is required.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   * @throws Error - When no adapter is registered for the requested provider type.
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
   * @param user - The administrator adding the provider account.
   * @param input - Provider type, display name, instance URL, enabled state, and read-only access token.
   * @returns The encrypted provider account record.
   * @throws BadRequestException - A Gitea base URL is required.
   * @throws ForbiddenException - System administrator access is required.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   * @throws Error - When no adapter is registered for the requested provider type.
   */
  async create(
    user: AuthenticatedUser,
    input: {
      providerType: 'GITHUB' | 'GITLAB' | 'FORGEJO' | 'GITEA';
      displayName: string;
      baseUrl?: string;
      enabled?: boolean;
      accessToken: string;
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
      },
    });
  }
  /**
   * Update the selected local resource after authorization and validation.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @param id - Local identifier of the target record.
   * @param input - Account fields to replace, including an optional replacement token; omitted credentials are
   * retained.
   * @returns The updated persisted account; the controller maps it to a credential-free DTO.
   * @throws BadRequestException - A Gitea base URL is required.
   * @throws ForbiddenException - System administrator access is required.
   * @throws NotFoundException - Provider account not found.
   */
  async update(
    user: AuthenticatedUser,
    id: string,
    input: {
      displayName?: string;
      baseUrl?: string | null;
      enabled?: boolean;
      accessToken?: string;
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
      },
    });
  }
  /**
   * Delete the selected local provider account and its dependent tracked data.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @param id - Local identifier of the target record.
   * @returns A promise that resolves when the operation completes.
   * @throws ForbiddenException - System administrator access is required.
   * @throws NotFoundException - Provider account not found.
   */
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    this.assertAdmin(user);
    await this.require(id);
    await this.prisma.providerAccount.delete({ where: { id } });
  }

  /**
   * Discover the repositories accessible through one enabled provider account.
   *
   * @param user - System administrator requesting the provider's read-only repository list.
   * @param providerAccountId - Configured provider account to inspect.
   * @returns Provider repositories and whether each is already tracked by ezRepo.
   * @throws ForbiddenException - System administrator access is required.
   * @throws BadRequestException - Provider account is disabled.
   * @throws NotFoundException - Provider account not found.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   * @throws Error - When no adapter is registered for the requested provider type.
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
   * @param user - System administrator adding the tracked repository.
   * @param providerAccountId - Configured provider account that owns the repository.
   * @param providerRepositoryId - Provider-native repository identifier selected by the administrator.
   * @returns The persisted tracked repository.
   * @throws NotFoundException - When the selected repository is not accessible through the provider account.
   * @throws ForbiddenException - System administrator access is required.
   * @throws BadRequestException - Provider account is disabled.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   * @throws Error - When no adapter is registered for the requested provider type.
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

  /**
   * Ensures that a request belongs to a system administrator.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @returns No return value.
   * @throws ForbiddenException - System administrator access is required.
   */
  assertAdmin(user: AuthenticatedUser): void {
    if (user.role !== 'SYSTEM_ADMIN') throw new ForbiddenException('System administrator access is required.');
  }
  /**
   * Load a provider account or report that it does not exist.
   *
   * @param id - Local identifier of the target record.
   * @returns The requested persisted provider account.
   * @throws NotFoundException - Provider account not found.
   */
  private async require(id: string) {
    const account = await this.prisma.providerAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Provider account not found.');
    return account;
  }

  /**
   * Load a provider account that may safely be used for outbound read-only requests.
   *
   * @param id - Local identifier of the target record.
   * @returns The enabled local provider account.
   * @throws BadRequestException - Provider account is disabled.
   * @throws NotFoundException - Provider account not found.
   */
  private async requireEnabled(id: string): Promise<ProviderAccount> {
    const account = await this.require(id);
    if (!account.enabled) throw new BadRequestException('Provider account is disabled.');
    return account;
  }

  /**
   * Discover repositories without exposing the provider credential outside this service.
   *
   * @param account - Persisted provider account and encrypted credential metadata.
   * @returns Provider repositories discovered using the selected local account.
   * @throws BadRequestException - Provider repositories could not be loaded.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   * @throws Error - When no adapter is registered for the requested provider type.
   */
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

  /**
   * Verify a candidate's credentials through the provider's read-only account endpoint.
   *
   * @param input - Provider type, instance URL, and read-only credential to validate before persistence.
   * @returns A promise that resolves when the operation completes.
   * @throws BadRequestException - Provider credentials could not be validated.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   * @throws Error - When no adapter is registered for the requested provider type.
   */
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
