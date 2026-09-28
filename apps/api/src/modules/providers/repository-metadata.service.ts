import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { ProviderAccount, Repository } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { ProviderAdapterRegistry } from './provider-adapter.registry.js';
import { ProviderCredentialService } from './provider-credential.service.js';

type RepositoryWithProviderAccount = Repository & {
  providerAccount: Pick<ProviderAccount, 'baseUrl' | 'encryptedAccessToken' | 'id' | 'providerType'>;
};

/** Refreshes locally persisted repository metadata through read-only provider APIs. */
@Injectable()
export class RepositoryMetadataService {
  /**
   * Initialize RepositoryMetadataService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   * @param adapters - Registry resolving the read-only adapter for each provider type.
   * @param credentials - Service encrypting and decrypting persisted credentials.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: ProviderAdapterRegistry,
    private readonly credentials: ProviderCredentialService,
  ) {}

  /**
   * Refresh one repository selected by a system administrator.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @param repositoryId - Local identifier of the tracked repository.
   * @returns The refreshed tracked repository.
   * @throws ForbiddenException - System administrator access is required.
   * @throws NotFoundException - Repository not found.
   * @throws BadRequestException - Provider account is disabled.
   * @throws ConflictException - Provider repository identity does not match the tracked repository.
   * @throws Error - When no adapter is registered for the requested provider type.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  async refreshById(user: AuthenticatedUser, repositoryId: string): Promise<Repository> {
    if (user.role !== 'SYSTEM_ADMIN') throw new ForbiddenException('System administrator access is required.');
    const repository = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
      include: { providerAccount: true },
    });
    if (!repository) throw new NotFoundException('Repository not found.');
    if (!repository.providerAccount.enabled) throw new BadRequestException('Provider account is disabled.');
    return this.refresh(repository);
  }

  /**
   * Resolve and persist the current provider-owned name, namespace, and URL.
   *
   * @typeParam T - Result type preserved by this operation.
   * @param repository - Repository identity and metadata required by the operation.
   * @returns The repository with its refreshed provider metadata.
   * @throws NotFoundException - Provider repository not found.
   * @throws ConflictException - Provider repository identity does not match the tracked repository.
   * @throws Error - When no adapter is registered for the requested provider type.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  async refresh<T extends RepositoryWithProviderAccount>(repository: T): Promise<T> {
    const adapter = this.adapters.get(repository.providerAccount.providerType);
    const metadata = await adapter.getRepository(
      {
        accessToken: this.credentials.decrypt(repository.providerAccount.encryptedAccessToken),
        baseUrl: repository.providerAccount.baseUrl,
        providerAccountId: repository.providerAccount.id,
      },
      repository,
    );
    if (!metadata) throw new NotFoundException('Provider repository not found.');
    if (metadata.providerRepositoryId !== repository.providerRepositoryId)
      throw new ConflictException('Provider repository identity does not match the tracked repository.');

    if (metadata.name === repository.name && metadata.owner === repository.owner && metadata.url === repository.url)
      return repository;

    await this.prisma.repository.update({
      where: { id: repository.id },
      data: { name: metadata.name, owner: metadata.owner, url: metadata.url },
    });
    return { ...repository, name: metadata.name, owner: metadata.owner, url: metadata.url };
  }
}
