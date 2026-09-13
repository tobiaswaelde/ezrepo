import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  NotificationChannelType,
  NotificationDeliveryKind,
  NotificationDeliveryStatus,
  type Prisma,
} from '../../generated/prisma/client.js';
import { JobRunnerService } from '../../jobs/job-runner.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppriseNotificationAdapter } from './apprise-notification.adapter.js';
import { BrowserPushService } from './browser-push.service.js';
import type { NotificationPayload } from './notification-channel-adapter.js';

const channelInclude = { browserRecipient: { select: { id: true, username: true } } } as const;
const deliveryInclude = {
  notificationRule: {
    include: { channelLinks: { include: { notificationChannel: { include: channelInclude } } } },
  },
  testChannel: {
    include: { ...channelInclude, repository: { include: { providerAccount: true } } },
  },
  workflowRun: { include: { repository: { include: { providerAccount: true } } } },
  attempts: { orderBy: { createdAt: 'desc' } },
} as const;

type NotificationDeliveryModel = Prisma.NotificationDeliveryGetPayload<{ include: typeof deliveryInclude }>;
type DeliveryChannel = NonNullable<NotificationDeliveryModel['testChannel']>;

const maximumAttempts = 3;

/** Return the bounded exponential delay before a subsequent delivery attempt. */
export function notificationRetryDelayMs(attempt: number): number {
  return Math.min(60_000 * 2 ** Math.max(attempt - 1, 0), 60 * 60_000);
}

/** Sends pending notification deliveries through Apprise or native browser push. */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobRunnerService,
    private readonly apprise: AppriseNotificationAdapter,
    private readonly browserPush: BrowserPushService,
  ) {}

  /** Retry delivery records whose bounded exponential delay has elapsed. */
  @Interval(60_000)
  async scheduleRetries(): Promise<void> {
    await this.jobs.run('notification-delivery-retry', () => this.deliverPending());
  }

  /** Attempt every requested pending delivery once, retaining an immutable attempt audit trail. */
  async deliverPending(deliveryIds?: string[]): Promise<void> {
    const now = new Date();
    const deliveries = await this.prisma.notificationDelivery.findMany({
      include: deliveryInclude,
      where: {
        status: NotificationDeliveryStatus.PENDING,
        ...(deliveryIds ? { id: { in: deliveryIds } } : {}),
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
    });
    for (const delivery of deliveries) await this.deliver(delivery);
  }

  private async deliver(delivery: NotificationDeliveryModel): Promise<void> {
    const enabledChannels = this.channelsFor(delivery).filter((channel) => channel.enabled);
    if (enabledChannels.length === 0) {
      await this.finish(delivery, false, 1, 'No enabled notification channels are configured.');
      return;
    }

    const payload = this.createPayload(delivery);
    const attemptNumber = Math.max(0, ...delivery.attempts.map((attempt) => attempt.attempt)) + 1;
    const failedChannelIds = new Set<string>();
    for (const channel of enabledChannels) {
      const deliveredSubscriptionIds = new Set(
        delivery.attempts
          .filter((attempt) => attempt.notificationChannelId === channel.id && attempt.deliveredAt)
          .flatMap((attempt) => (attempt.browserPushSubscriptionId ? [attempt.browserPushSubscriptionId] : [])),
      );
      const channelAlreadyDelivered = delivery.attempts.some(
        (attempt) =>
          attempt.notificationChannelId === channel.id && attempt.deliveredAt && !attempt.browserPushSubscriptionId,
      );
      if (channel.type !== NotificationChannelType.BROWSER_PUSH && channelAlreadyDelivered) continue;

      const delivered = await this.deliverChannel(delivery, channel, payload, attemptNumber, deliveredSubscriptionIds);
      if (!delivered) failedChannelIds.add(channel.id);
    }

    await this.finish(
      delivery,
      failedChannelIds.size === 0,
      attemptNumber,
      failedChannelIds.size > 0 ? 'One or more notification channels failed.' : null,
    );
    if (failedChannelIds.size > 0)
      this.logger.warn(`Notification delivery ${delivery.id} failed for ${failedChannelIds.size} channel(s).`);
  }

  private async deliverChannel(
    delivery: NotificationDeliveryModel,
    channel: DeliveryChannel,
    payload: NotificationPayload,
    attempt: number,
    deliveredSubscriptionIds: Set<string>,
  ): Promise<boolean> {
    if (channel.type !== NotificationChannelType.BROWSER_PUSH) {
      try {
        await this.apprise.send(channel, payload);
        await this.createAttempt(delivery.id, channel.id, attempt, true);
        return true;
      } catch (error) {
        await this.createAttempt(delivery.id, channel.id, attempt, false, this.errorMessage(error));
        return false;
      }
    }

    try {
      if (!channel.browserRecipientUserId) throw new Error('Browser push recipient is missing.');
      const results = await this.browserPush.sendToUser(
        channel.browserRecipientUserId,
        payload,
        deliveredSubscriptionIds,
      );
      for (const result of results) {
        if (!result.recordAttempt) continue;
        await this.createAttempt(
          delivery.id,
          channel.id,
          attempt,
          result.delivered,
          result.error,
          result.subscriptionId,
        );
      }
      return results.every((result) => result.delivered);
    } catch {
      await this.createAttempt(delivery.id, channel.id, attempt, false, 'Browser push delivery failed.');
      return false;
    }
  }

  private async createAttempt(
    deliveryId: string,
    channelId: string,
    attempt: number,
    delivered: boolean,
    error: string | null = null,
    subscriptionId?: string,
  ): Promise<void> {
    await this.prisma.notificationDeliveryAttempt.create({
      data: {
        attempt,
        deliveredAt: delivered ? new Date() : null,
        error,
        notificationChannelId: channelId,
        notificationDeliveryId: deliveryId,
        ...(subscriptionId ? { browserPushSubscriptionId: subscriptionId } : {}),
      },
    });
  }

  private async finish(
    delivery: NotificationDeliveryModel,
    delivered: boolean,
    attemptNumber: number,
    error: string | null,
  ): Promise<void> {
    const terminalFailure = delivery.kind === NotificationDeliveryKind.TEST || attemptNumber >= maximumAttempts;
    await this.prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: delivered
        ? { finalError: null, nextAttemptAt: null, status: NotificationDeliveryStatus.DELIVERED }
        : terminalFailure
          ? { finalError: error, nextAttemptAt: null, status: NotificationDeliveryStatus.FAILED }
          : {
              finalError: null,
              nextAttemptAt: new Date(Date.now() + notificationRetryDelayMs(attemptNumber)),
              status: NotificationDeliveryStatus.PENDING,
            },
    });
  }

  private channelsFor(delivery: NotificationDeliveryModel): DeliveryChannel[] {
    if (delivery.kind === NotificationDeliveryKind.TEST) return delivery.testChannel ? [delivery.testChannel] : [];
    return (delivery.notificationRule?.channelLinks.map((link) => link.notificationChannel) ?? []) as DeliveryChannel[];
  }

  private createPayload(delivery: NotificationDeliveryModel): NotificationPayload {
    if (delivery.kind === NotificationDeliveryKind.TEST) {
      if (!delivery.testChannel) throw new Error('Test notification channel is missing.');
      return {
        completedAt: new Date(),
        durationMs: 0,
        provider: delivery.testChannel.repository.providerAccount.providerType,
        repository: `${delivery.testChannel.repository.owner}/${delivery.testChannel.repository.name}`,
        runUrl: '',
        status: 'SUCCESS',
        workflowName: 'ezRepo test notification',
      };
    }
    const workflowRun = delivery.workflowRun;
    if (!workflowRun) throw new Error('Workflow notification run is missing.');
    return {
      completedAt: workflowRun.completedAt,
      durationMs: workflowRun.durationMs,
      provider: workflowRun.repository.providerAccount.providerType,
      repository: `${workflowRun.repository.owner}/${workflowRun.repository.name}`,
      runUrl: workflowRun.url,
      status: workflowRun.status,
      workflowName: workflowRun.workflowName,
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error && error.message === 'Apprise notification delivery failed.'
      ? error.message
      : 'Notification delivery failed.';
  }
}
