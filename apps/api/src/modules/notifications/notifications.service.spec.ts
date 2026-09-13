import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { CaslAbilityFactory } from '../../casl/casl-ability.factory.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CredentialEncryptionService } from '../../security/credential-encryption.service.js';
import { WorkflowFilterService } from '../repositories/workflow-filter.service.js';
import type { BrowserPushService } from './browser-push.service.js';
import { NotificationChannelUrlService } from './notification-channel-url.service.js';
import type { NotificationDeliveryService } from './notification-delivery.service.js';
import { NotificationsService } from './notifications.service.js';

describe('NotificationsService', () => {
  const user = { id: 'user-a', role: 'VIEWER' as const, username: 'viewer' };

  function createService() {
    const prisma = {
      notificationChannel: {
        create: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      notificationRule: {
        create: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      notificationDelivery: {
        create: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn(),
      },
      repositoryMembership: {
        findMany: jest.fn().mockResolvedValue([{ repositoryId: 'repository-a', role: 'VIEWER' }]),
        findUnique: jest.fn(),
      },
    };
    return {
      prisma,
      service: new NotificationsService(
        prisma as unknown as PrismaService,
        new CaslAbilityFactory(),
        {
          decrypt: jest.fn(),
          encrypt: jest.fn((secret: string) => `encrypted:${secret}`),
        } as unknown as CredentialEncryptionService,
        new WorkflowFilterService(),
        { deliverPending: jest.fn() } as unknown as NotificationDeliveryService,
        new NotificationChannelUrlService(),
        { available: true } as BrowserPushService,
      ),
    };
  }

  it('limits channel lists to repositories visible through persisted memberships', async () => {
    const { prisma, service } = createService();

    await service.listChannels(user);

    expect(prisma.notificationChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ OR: [{ repositoryId: { in: ['repository-a'] } }] }],
        },
      }),
    );
  });

  it('requires a manager membership before creating a channel', async () => {
    const { prisma, service } = createService();
    prisma.repositoryMembership.findUnique.mockResolvedValue({ role: 'VIEWER' });

    await expect(
      service.createChannel(
        { ...user, role: 'MANAGER' },
        {
          repositoryId: 'repository-a',
          name: 'On-call',
          url: 'discord://webhook-id/webhook-token',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('encrypts an Apprise URL and retains only its safe scheme metadata', async () => {
    const { prisma, service } = createService();
    prisma.repositoryMembership.findUnique.mockResolvedValue({ role: 'MANAGER' });
    prisma.notificationChannel.create.mockResolvedValue({});

    await service.createChannel(
      { ...user, role: 'MANAGER' },
      {
        repositoryId: 'repository-a',
        name: 'On-call',
        url: 'discord://webhook-id/webhook-token',
      },
    );

    expect(prisma.notificationChannel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          encryptedUrl: 'encrypted:discord://webhook-id/webhook-token',
          requiresReconfiguration: false,
          urlScheme: 'discord',
        }),
      }),
    );
  });

  it('rejects unsafe local-file URLs and legacy channels re-enabled without replacement URLs', async () => {
    const { prisma, service } = createService();
    prisma.repositoryMembership.findUnique.mockResolvedValue({ role: 'MANAGER' });

    await expect(
      service.createChannel(
        { ...user, role: 'MANAGER' },
        { name: 'Unsafe', repositoryId: 'repository-a', url: 'file:///tmp/x' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.notificationChannel.findUnique.mockResolvedValue({
      id: 'channel-a',
      repositoryId: 'repository-a',
      requiresReconfiguration: true,
    });
    await expect(
      service.updateChannel({ ...user, role: 'MANAGER' }, 'channel-a', { enabled: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates a workflow glob rule linked only to channels from its repository', async () => {
    const { prisma, service } = createService();
    prisma.repositoryMembership.findUnique.mockResolvedValue({ role: 'MANAGER' });
    prisma.notificationChannel.findMany.mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111' }]);
    prisma.notificationRule.create.mockResolvedValue({});

    await service.createRule(
      { ...user, role: 'MANAGER' },
      {
        repositoryId: 'repository-a',
        workflowPattern: 'Deploy*',
        outcome: 'FAILED',
        channelIds: ['11111111-1111-4111-8111-111111111111'],
      },
    );

    expect(prisma.notificationRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channelLinks: {
            createMany: { data: [{ notificationChannelId: '11111111-1111-4111-8111-111111111111' }] },
          },
          outcome: 'FAILED',
          workflowPattern: 'Deploy*',
        }),
      }),
    );
  });

  it('evaluates only enabled rules matching a terminal run outcome and workflow glob', async () => {
    const { prisma, service } = createService();
    prisma.notificationRule.findMany.mockResolvedValue([
      { channelLinks: [], id: 'rule-a', workflowPattern: 'Deploy*' },
      { channelLinks: [], id: 'rule-b', workflowPattern: 'Test*' },
    ]);

    const rules = await service.evaluateRulesForRun({
      id: 'run-a',
      repositoryId: 'repository-a',
      status: 'FAILED',
      workflowName: 'Deploy production',
    });

    expect(rules).toEqual([{ channelLinks: [], id: 'rule-a', workflowPattern: 'Deploy*' }]);
    expect(prisma.notificationRule.findMany).toHaveBeenCalledWith({
      include: expect.any(Object),
      where: { enabled: true, outcome: 'FAILED', repositoryId: 'repository-a' },
    });
    expect(prisma.notificationDelivery.createMany).toHaveBeenCalledWith({
      data: [{ notificationRuleId: 'rule-a', workflowRunId: 'run-a' }],
      skipDuplicates: true,
    });
  });

  it('limits delivery history to repository-manager memberships', async () => {
    const { prisma, service } = createService();
    prisma.repositoryMembership.findMany.mockResolvedValue([{ repositoryId: 'repository-managed', role: 'MANAGER' }]);

    await service.listDeliveryHistory({ ...user, role: 'MANAGER' });

    expect(prisma.notificationDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { notificationRule: { repositoryId: { in: ['repository-managed'] } } },
            { testChannel: { repositoryId: { in: ['repository-managed'] } } },
          ],
        },
      }),
    );
  });

  it('creates a non-retrying test delivery for a managed channel', async () => {
    const { prisma, service } = createService();
    prisma.repositoryMembership.findUnique.mockResolvedValue({ role: 'MANAGER' });
    prisma.notificationChannel.findUnique.mockResolvedValue({
      browserRecipientUserId: null,
      id: 'channel-a',
      repositoryId: 'repository-a',
      type: 'CUSTOM_APPRISE',
    });
    prisma.notificationDelivery.create.mockResolvedValue({ id: 'delivery-a' });
    prisma.notificationDelivery.findUniqueOrThrow.mockResolvedValue({ id: 'delivery-a' });

    await service.testChannel({ ...user, role: 'MANAGER' }, 'channel-a');

    expect(prisma.notificationDelivery.create).toHaveBeenCalledWith({
      data: {
        kind: 'TEST',
        requestedByUserId: 'user-a',
        testChannelId: 'channel-a',
      },
      select: { id: true },
    });
  });
});
