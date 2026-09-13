import { UnauthorizedException } from '@nestjs/common';

import type { PrismaService } from '../../prisma/prisma.service.js';
import type { ProviderAdapterRegistry } from '../providers/provider-adapter.registry.js';
import type { ProviderCredentialService } from '../providers/provider-credential.service.js';
import type { ProviderSyncQueueService } from '../providers/sync-queue.service.js';
import { WebhookService } from './webhook.service.js';

describe('WebhookService', () => {
  const payload = Buffer.from('{"repository":{"id":42}}');

  it.each([
    ['GITHUB', 'x-github-delivery'],
    ['GITLAB', 'x-gitlab-event-uuid'],
    ['FORGEJO', 'x-forgejo-delivery'],
    ['GITEA', 'x-gitea-delivery'],
  ] as const)(
    'records and queues a verified %s delivery for the URL repository',
    async (providerType, deliveryHeader) => {
      const mocks = createMocks(providerType);

      await expect(
        createService(mocks).receive(providerType, 'repository-id', {
          headers: { [deliveryHeader]: 'delivery-id' },
          payload,
        }),
      ).resolves.toEqual({ accepted: true, duplicate: false });
      expect(mocks.credentials.decrypt).toHaveBeenCalledWith('encrypted-secret');
      expect(mocks.transaction.webhookDelivery.create).toHaveBeenCalledWith({
        data: { deliveryId: 'delivery-id', event: 'workflow_run', repositoryId: 'repository-id' },
      });
      expect(mocks.syncQueue.enqueueWebhookRepository).toHaveBeenCalledWith('repository-id', mocks.transaction, [
        'WORKFLOWS',
      ]);
    },
  );

  it('accepts a repeated repository delivery without scheduling it again', async () => {
    const mocks = createMocks('GITLAB');
    mocks.transaction.webhookDelivery.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      createService(mocks).receive('GITLAB', 'repository-id', {
        headers: { 'x-gitlab-event-uuid': 'delivery-id' },
        payload,
      }),
    ).resolves.toEqual({ accepted: true, duplicate: true });
    expect(mocks.syncQueue.enqueueWebhookRepository).not.toHaveBeenCalled();
  });

  it.each([
    { encryptedWebhookSecret: null },
    { enabled: false },
    { providerAccount: { enabled: false, providerType: 'GITHUB' } },
  ])('rejects an unavailable repository webhook configuration', async (override) => {
    const mocks = createMocks('GITHUB', override);

    await expect(
      createService(mocks).receive('GITHUB', 'repository-id', {
        headers: { 'x-github-delivery': 'delivery-id' },
        payload,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mocks.adapter.verifyWebhook).not.toHaveBeenCalled();
  });

  it('rejects a provider type that does not own the repository', async () => {
    const mocks = createMocks('GITHUB');

    await expect(
      createService(mocks).receive('FORGEJO', 'repository-id', {
        headers: { 'x-forgejo-delivery': 'delivery-id' },
        payload,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a signed payload for another provider repository', async () => {
    const mocks = createMocks('GITHUB');
    mocks.adapter.verifyWebhook.mockResolvedValue({
      event: 'workflow_run',
      providerRepositoryId: '99',
      syncScopes: ['WORKFLOWS'],
    });

    await expect(
      createService(mocks).receive('GITHUB', 'repository-id', {
        headers: { 'x-github-delivery': 'delivery-id' },
        payload,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mocks.transaction.webhookDelivery.create).not.toHaveBeenCalled();
  });
});

function createMocks(
  providerType: 'GITHUB' | 'GITLAB' | 'FORGEJO' | 'GITEA',
  repositoryOverride: Record<string, unknown> = {},
) {
  const transaction = { webhookDelivery: { create: jest.fn().mockResolvedValue(undefined) } };
  return {
    adapter: {
      verifyWebhook: jest.fn().mockResolvedValue({
        event: 'workflow_run',
        providerRepositoryId: '42',
        syncScopes: ['WORKFLOWS'],
      }),
    },
    credentials: { decrypt: jest.fn().mockReturnValue('webhook-secret') },
    prisma: {
      repository: {
        findUnique: jest.fn().mockResolvedValue({
          enabled: true,
          encryptedWebhookSecret: 'encrypted-secret',
          providerAccount: { enabled: true, providerType },
          providerRepositoryId: '42',
          ...repositoryOverride,
        }),
      },
      transaction: jest.fn((callback) => callback(transaction)),
    },
    syncQueue: { enqueueWebhookRepository: jest.fn().mockResolvedValue(true) },
    transaction,
  };
}

function createService(mocks: ReturnType<typeof createMocks>): WebhookService {
  return new WebhookService(
    mocks.prisma as unknown as PrismaService,
    { get: jest.fn().mockReturnValue(mocks.adapter) } as unknown as ProviderAdapterRegistry,
    mocks.credentials as unknown as ProviderCredentialService,
    mocks.syncQueue as unknown as ProviderSyncQueueService,
  );
}
