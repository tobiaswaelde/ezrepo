import { BadRequestException, ForbiddenException } from '@nestjs/common';

import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CredentialEncryptionService } from '../../security/credential-encryption.service.js';
import { WorkflowFilterService } from '../repositories/workflow-filter.service.js';
import type { BrowserPushService } from './browser-push.service.js';
import { NotificationChannelUrlService } from './notification-channel-url.service.js';
import type { NotificationDeliveryService } from './notification-delivery.service.js';
import { NotificationsService } from './notifications.service.js';

describe('NotificationsService', () => {
  const viewer = { id: 'user-a', role: 'VIEWER' as const, username: 'viewer' };
  const admin = { id: 'admin-a', role: 'SYSTEM_ADMIN' as const, username: 'admin' };
  const failedRun = {
    id: 'run-a',
    providerCreatedAt: new Date('2026-09-14T10:00:00.000Z'),
    repositoryId: 'repository-a',
    scopeKey: 'refs/heads/main',
    status: 'SUCCESS' as const,
    workflowId: 'workflow-a',
    workflowName: 'Deploy production',
  };

  function createService() {
    const prisma = {
      notificationChannel: {
        count: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      notificationDelivery: {
        create: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn(),
      },
      repository: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn() },
      user: { count: jest.fn().mockResolvedValue(0) },
      workflowRun: { findFirst: jest.fn() },
    };
    const delivery = { deliverPending: jest.fn() };
    return {
      delivery,
      prisma,
      service: new NotificationsService(
        prisma as unknown as PrismaService,
        {
          decrypt: jest.fn(),
          encrypt: jest.fn((secret: string) => `encrypted:${secret}`),
        } as unknown as CredentialEncryptionService,
        new WorkflowFilterService(),
        delivery as unknown as NotificationDeliveryService,
        new NotificationChannelUrlService(),
        { available: true } as BrowserPushService,
      ),
    };
  }

  it('lists global channels without applying repository membership filters', async () => {
    const { prisma, service } = createService();

    await service.listChannels();

    expect(prisma.notificationChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    );
  });

  it('allows only system administrators to mutate global channels or read history', async () => {
    const { service } = createService();
    const eventSubscriptions = [{ eventType: 'ISSUE_OPENED' as const }];

    await expect(service.createChannel(viewer, { eventSubscriptions, name: 'On-call' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.listDeliveryHistory(viewer)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('encrypts destination configuration and persists normalized global event filters', async () => {
    const { prisma, service } = createService();
    prisma.repository.count.mockResolvedValue(1);
    prisma.notificationChannel.create.mockResolvedValue({});

    await service.createChannel(admin, {
      eventSubscriptions: [
        {
          eventType: 'WORKFLOW_RUN_FAILED',
          repositoryIds: ['11111111-1111-4111-8111-111111111111'],
          workflowPatterns: [' Deploy* ', 'Deploy*'],
        },
      ],
      name: 'On-call',
      type: 'CUSTOM_APPRISE',
      url: 'discord://webhook-id/webhook-token',
    });

    expect(prisma.notificationChannel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          encryptedUrl: 'encrypted:discord://webhook-id/webhook-token',
          eventSubscriptions: {
            create: [
              expect.objectContaining({
                eventType: 'WORKFLOW_RUN_FAILED',
                workflowPatterns: ['Deploy*'],
              }),
            ],
          },
          urlScheme: 'discord',
        }),
      }),
    );
  });

  it('requires recipients only for browser-push channels', async () => {
    const { prisma, service } = createService();
    prisma.user.count.mockResolvedValue(1);
    prisma.notificationChannel.create.mockResolvedValue({});
    const eventSubscriptions = [{ eventType: 'ISSUE_OPENED' as const }];

    await expect(
      service.createChannel(admin, { eventSubscriptions, name: 'Push', type: 'BROWSER_PUSH' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createChannel(admin, {
        browserRecipientUserIds: ['11111111-1111-4111-8111-111111111111'],
        eventSubscriptions,
        name: 'Email',
        type: 'EMAIL',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not emit workflow notifications while establishing a baseline', async () => {
    const { prisma, service } = createService();

    await service.evaluateWorkflowRun(failedRun, null, true);

    expect(prisma.notificationChannel.findMany).not.toHaveBeenCalled();
    expect(prisma.notificationDelivery.createMany).not.toHaveBeenCalled();
  });

  it('emits one recovered delivery when either success or recovery matches', async () => {
    const { delivery, prisma, service } = createService();
    prisma.workflowRun.findFirst.mockResolvedValue({ status: 'FAILED' });
    prisma.notificationChannel.findMany.mockResolvedValue([
      {
        eventSubscriptions: [{ eventType: 'WORKFLOW_RUN_SUCCEEDED', repositories: [], workflowPatterns: ['Deploy*'] }],
        id: 'channel-a',
      },
    ]);
    prisma.notificationDelivery.findMany.mockResolvedValue([{ id: 'delivery-a' }]);

    await service.evaluateWorkflowRun(failedRun, 'RUNNING', false);

    expect(prisma.notificationDelivery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          eventType: 'WORKFLOW_RUN_RECOVERED',
          notificationChannelId: 'channel-a',
          workflowRunId: 'run-a',
        }),
      ],
      skipDuplicates: true,
    });
    expect(delivery.deliverPending).toHaveBeenCalledWith(['delivery-a']);
  });

  it('does not emit an event when a workflow glob does not match', async () => {
    const { prisma, service } = createService();
    prisma.notificationChannel.findMany.mockResolvedValue([
      {
        eventSubscriptions: [{ eventType: 'WORKFLOW_RUN_FAILED', repositories: [], workflowPatterns: ['Test*'] }],
        id: 'channel-a',
      },
    ]);

    await service.evaluateWorkflowRun({ ...failedRun, status: 'FAILED' }, 'RUNNING', false);

    expect(prisma.notificationDelivery.createMany).not.toHaveBeenCalled();
  });
});
