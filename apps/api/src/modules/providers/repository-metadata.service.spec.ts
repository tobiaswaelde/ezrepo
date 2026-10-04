import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { RepositoryMetadataService } from './repository-metadata.service.js';

describe('RepositoryMetadataService', () => {
  const repository = {
    createdAt: new Date('2026-09-12T08:00:00.000Z'),
    enabled: true,
    id: 'repository-id',
    lastSyncAt: null,
    name: 'old-name',
    owner: 'old-owner',
    providerAccountId: 'provider-id',
    providerRepositoryId: '42',
    updatedAt: new Date('2026-09-12T08:00:00.000Z'),
    url: 'https://example.test/old-owner/old-name',
    workflowRunRetentionDays: null,
    providerAccount: {
      baseUrl: null,
      createdAt: new Date('2026-09-12T08:00:00.000Z'),
      displayName: 'Provider',
      enabled: true,
      encryptedAccessToken: 'encrypted-token',
      encryptedWebhookSecret: null,
      id: 'provider-id',
      lastSyncAt: null,
      lastSyncError: null,
      providerType: 'GITHUB' as const,
      updatedAt: new Date('2026-09-12T08:00:00.000Z'),
    },
  };
  const prisma = {
    repository: { findUnique: jest.fn().mockResolvedValue(repository), update: jest.fn().mockResolvedValue(undefined) },
  };
  const adapter = { getRepository: jest.fn() };
  const service = new RepositoryMetadataService(
    prisma as never,
    { get: jest.fn().mockReturnValue(adapter) } as never,
    { decrypt: jest.fn().mockReturnValue('access-token') } as never,
  );
  const admin = { authProvider: 'LOCAL' as const, id: 'admin', role: 'SYSTEM_ADMIN' as const, username: 'admin' };

  beforeEach(() => jest.clearAllMocks());

  it('updates changed provider-owned metadata without changing repository identity', async () => {
    adapter.getRepository.mockResolvedValue({
      name: 'new-name',
      owner: 'new-owner',
      providerRepositoryId: '42',
      url: 'https://example.test/new-owner/new-name',
    });

    await expect(service.refreshById(admin, repository.id)).resolves.toMatchObject({
      id: repository.id,
      name: 'new-name',
      owner: 'new-owner',
      providerRepositoryId: '42',
    });
    expect(prisma.repository.update).toHaveBeenCalledWith({
      where: { id: repository.id },
      data: {
        name: 'new-name',
        owner: 'new-owner',
        url: 'https://example.test/new-owner/new-name',
      },
    });
  });

  it('does not write when provider metadata is unchanged', async () => {
    adapter.getRepository.mockResolvedValue({
      name: repository.name,
      owner: repository.owner,
      providerRepositoryId: repository.providerRepositoryId,
      url: repository.url,
    });

    await expect(service.refreshById(admin, repository.id)).resolves.toBe(repository);
    expect(prisma.repository.update).not.toHaveBeenCalled();
  });

  it('preserves local metadata when the provider repository is missing or has another identity', async () => {
    adapter.getRepository.mockResolvedValueOnce(null);
    await expect(service.refreshById(admin, repository.id)).rejects.toBeInstanceOf(NotFoundException);

    adapter.getRepository.mockResolvedValueOnce({
      name: 'replacement',
      owner: repository.owner,
      providerRepositoryId: 'different-id',
      url: repository.url,
    });
    await expect(service.refreshById(admin, repository.id)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.repository.update).not.toHaveBeenCalled();
  });

  it('rejects non-administrators before reading the repository', async () => {
    await expect(
      service.refreshById(
        { authProvider: 'LOCAL' as const, id: 'viewer', role: 'VIEWER', username: 'viewer' },
        repository.id,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.repository.findUnique).not.toHaveBeenCalled();
  });
});
