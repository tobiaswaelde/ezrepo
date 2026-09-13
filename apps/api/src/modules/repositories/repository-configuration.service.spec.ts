import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { RepositoryConfigurationService } from './repository-configuration.service.js';

describe('RepositoryConfigurationService', () => {
  const repository = { id: 'repository-id' };
  const prisma = {
    repository: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    repositoryMembership: { delete: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
    user: { findUnique: jest.fn() },
    workflowFilter: { create: jest.fn(), delete: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  };
  const credentials = { encrypt: jest.fn((value: string) => `encrypted:${value}`) };
  const filters = { validatePattern: jest.fn() };
  const service = new RepositoryConfigurationService(prisma as never, credentials as never, filters as never);
  const administrator = { id: 'administrator', role: 'SYSTEM_ADMIN' as const, username: 'admin' };
  const manager = { id: 'manager', role: 'MANAGER' as const, username: 'manager' };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.repository.findUnique.mockResolvedValue(repository);
  });

  it('rejects non-administrators before reading repository configuration', async () => {
    await expect(service.listWorkflowFilters(manager, repository.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.repository.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['list', () => service.listWebhookConfigurations(manager)],
    ['set', () => service.setWebhookSecret(manager, repository.id, 'secret')],
    ['clear', () => service.clearWebhookSecret(manager, repository.id)],
  ])('rejects non-administrators attempting to %s repository webhook configuration', async (_operation, call) => {
    await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.repository.findMany).not.toHaveBeenCalled();
    expect(prisma.repository.update).not.toHaveBeenCalled();
  });

  it('returns repository webhook metadata without exposing encrypted secrets', async () => {
    prisma.repository.findMany.mockResolvedValue([
      {
        encryptedWebhookSecret: 'encrypted-secret',
        id: repository.id,
        providerAccount: { providerType: 'GITHUB' },
        webhookDeliveries: [{ createdAt: new Date('2026-09-13T12:00:00.000Z') }],
      },
    ]);

    const configurations = await service.listWebhookConfigurations(administrator);

    expect(configurations).toEqual([
      {
        callbackUrl: 'http://localhost:3000/api/webhooks/github/repository-id',
        configured: true,
        lastDeliveryAt: new Date('2026-09-13T12:00:00.000Z'),
        providerType: 'GITHUB',
        repositoryId: repository.id,
      },
    ]);
    expect(JSON.stringify(configurations)).not.toContain('encrypted-secret');
  });

  it('encrypts a repository webhook secret and returns safe metadata', async () => {
    prisma.repository.update.mockResolvedValue({
      id: repository.id,
      providerAccount: { providerType: 'GITHUB' },
      webhookDeliveries: [],
    });

    await expect(service.setWebhookSecret(administrator, repository.id, 'secret')).resolves.toEqual(
      expect.objectContaining({ configured: true, repositoryId: repository.id }),
    );
    expect(prisma.repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { encryptedWebhookSecret: 'encrypted:secret' } }),
    );
  });

  it('clears only the selected repository webhook secret', async () => {
    await service.clearWebhookSecret(administrator, repository.id);

    expect(prisma.repository.update).toHaveBeenCalledWith({
      data: { encryptedWebhookSecret: null },
      where: { id: repository.id },
    });
  });

  it('validates a workflow pattern before creating a filter', async () => {
    prisma.workflowFilter.create.mockResolvedValue({ id: 'filter-id', mode: 'DENY', pattern: 'draft-*' });

    await service.createWorkflowFilter(administrator, repository.id, { mode: 'DENY', pattern: ' draft-* ' });

    expect(filters.validatePattern).toHaveBeenCalledWith(' draft-* ');
    expect(prisma.workflowFilter.create).toHaveBeenCalledWith({
      data: { mode: 'DENY', pattern: 'draft-*', repositoryId: repository.id },
    });
  });

  it('rejects a workflow-filter removal outside the selected repository', async () => {
    prisma.workflowFilter.findFirst.mockResolvedValue(null);

    await expect(service.deleteWorkflowFilter(administrator, repository.id, 'filter-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.workflowFilter.delete).not.toHaveBeenCalled();
  });

  it('upserts a verified user membership for the selected repository', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-id' });
    prisma.repositoryMembership.upsert.mockResolvedValue({
      id: 'membership-id',
      repositoryId: repository.id,
      userId: 'user-id',
    });

    await service.upsertMembership(administrator, repository.id, { role: 'MANAGER', userId: 'user-id' });

    expect(prisma.repositoryMembership.upsert).toHaveBeenCalledWith({
      where: { userId_repositoryId: { repositoryId: repository.id, userId: 'user-id' } },
      create: { repositoryId: repository.id, role: 'MANAGER', userId: 'user-id' },
      update: { role: 'MANAGER' },
      include: { user: { include: { avatar: { select: { updatedAt: true } } } } },
    });
  });

  it('does not create a membership for an unknown user', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.upsertMembership(administrator, repository.id, { role: 'VIEWER', userId: 'missing-user' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.repositoryMembership.upsert).not.toHaveBeenCalled();
  });
});
