import { NotificationDeliveryStatus } from '../../generated/prisma/client.js';
import type { JobRunnerService } from '../../jobs/job-runner.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AppriseNotificationAdapter } from './apprise-notification.adapter.js';
import type { BrowserPushService } from './browser-push.service.js';
import { NotificationDeliveryService, notificationRetryDelayMs } from './notification-delivery.service.js';

describe('NotificationDeliveryService', () => {
  it('uses bounded exponential retry delays', () => {
    expect(notificationRetryDelayMs(1)).toBe(60_000);
    expect(notificationRetryDelayMs(2)).toBe(120_000);
    expect(notificationRetryDelayMs(10)).toBe(60 * 60_000);
  });

  it('records a failed attempt and schedules a retry without resending completed channels', async () => {
    const prisma = {
      notificationDelivery: {
        findMany: jest.fn().mockResolvedValue([
          {
            attempts: [],
            id: 'delivery-a',
            eventType: 'WORKFLOW_RUN_FAILED',
            issue: null,
            kind: 'EVENT',
            notificationChannel: {
              encryptedUrl: 'encrypted-url',
              enabled: true,
              id: 'channel-a',
              recipients: [],
              type: 'CUSTOM_APPRISE',
            },
            pullRequest: null,
            repository: {
              name: 'ezrepo',
              owner: 'ezrepo',
              providerAccount: { providerType: 'GITHUB' },
            },
            workflowRun: {
              completedAt: new Date('2026-08-26T12:00:00.000Z'),
              durationMs: 60_000,
              status: 'FAILED',
              url: 'https://github.com/ezrepo/ezrepo/actions/runs/1',
              workflowName: 'Test',
            },
          },
        ]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      notificationDeliveryAttempt: { create: jest.fn().mockResolvedValue(undefined) },
    };
    const apprise = { send: jest.fn().mockRejectedValue(new Error('Apprise notification delivery failed.')) };
    const service = new NotificationDeliveryService(
      prisma as unknown as PrismaService,
      {} as JobRunnerService,
      apprise as unknown as AppriseNotificationAdapter,
      { sendToUser: jest.fn() } as unknown as BrowserPushService,
    );

    await service.deliverPending(['delivery-a']);

    expect(prisma.notificationDeliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attempt: 1,
        error: 'Apprise notification delivery failed.',
        notificationChannelId: 'channel-a',
        notificationDeliveryId: 'delivery-a',
      }),
    });
    expect(prisma.notificationDelivery.update).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: NotificationDeliveryStatus.PENDING }),
      where: { id: 'delivery-a' },
    });
  });

  it('excludes browser devices that succeeded during an earlier retry attempt', async () => {
    const prisma = {
      notificationDelivery: {
        findMany: jest.fn().mockResolvedValue([
          {
            attempts: [
              {
                attempt: 1,
                browserPushSubscriptionId: 'subscription-success',
                deliveredAt: new Date('2026-09-13T10:00:00.000Z'),
                notificationChannelId: 'channel-push',
              },
              {
                attempt: 1,
                browserPushSubscriptionId: 'subscription-retry',
                deliveredAt: null,
                notificationChannelId: 'channel-push',
              },
            ],
            id: 'delivery-push',
            eventType: 'WORKFLOW_RUN_FAILED',
            issue: null,
            kind: 'EVENT',
            notificationChannel: {
              enabled: true,
              id: 'channel-push',
              recipients: [{ user: { id: 'user-a', username: 'user' } }],
              type: 'BROWSER_PUSH',
            },
            pullRequest: null,
            repository: {
              name: 'ezrepo',
              owner: 'ezrepo',
              providerAccount: { providerType: 'GITHUB' },
            },
            workflowRun: {
              completedAt: new Date('2026-09-13T10:00:00.000Z'),
              durationMs: 60_000,
              status: 'FAILED',
              url: 'https://github.com/ezrepo/ezrepo/actions/runs/1',
              workflowName: 'Test',
            },
          },
        ]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      notificationDeliveryAttempt: { create: jest.fn().mockResolvedValue(undefined) },
    };
    const browserPush = {
      sendToUser: jest
        .fn()
        .mockResolvedValue([
          { delivered: true, error: null, recordAttempt: true, subscriptionId: 'subscription-retry' },
        ]),
    };
    const service = new NotificationDeliveryService(
      prisma as unknown as PrismaService,
      {} as JobRunnerService,
      { send: jest.fn() } as unknown as AppriseNotificationAdapter,
      browserPush as unknown as BrowserPushService,
    );

    await service.deliverPending(['delivery-push']);

    expect(browserPush.sendToUser).toHaveBeenCalledWith(
      'user-a',
      expect.any(Object),
      new Set(['subscription-success']),
    );
    expect(prisma.notificationDeliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attempt: 2,
        browserPushSubscriptionId: 'subscription-retry',
        deliveredAt: expect.any(Date),
      }),
    });
    expect(prisma.notificationDelivery.update).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: NotificationDeliveryStatus.DELIVERED }),
      where: { id: 'delivery-push' },
    });
  });
});
