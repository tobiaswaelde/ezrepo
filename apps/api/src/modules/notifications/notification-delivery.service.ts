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

const deliveryInclude = {
  attempts: { orderBy: { createdAt: 'desc' } },
  issue: true,
  notificationChannel: {
    include: { recipients: { include: { user: { select: { id: true, username: true } } } } },
  },
  pullRequest: true,
  repository: { include: { providerAccount: true } },
  workflowRun: true,
} as const;

type NotificationDeliveryModel = Prisma.NotificationDeliveryGetPayload<{ include: typeof deliveryInclude }>;
type DeliveryChannel = NotificationDeliveryModel['notificationChannel'];

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
    const channel = delivery.notificationChannel;
    if (!channel.enabled) {
      await this.finish(delivery, false, 1, 'The notification channel is disabled.');
      return;
    }

    const payload = this.createPayload(delivery);
    const attemptNumber = Math.max(0, ...delivery.attempts.map((attempt) => attempt.attempt)) + 1;
    const deliveredSubscriptionIds = new Set(
      delivery.attempts.flatMap((attempt) =>
        attempt.deliveredAt && attempt.browserPushSubscriptionId ? [attempt.browserPushSubscriptionId] : [],
      ),
    );
    const channelAlreadyDelivered = delivery.attempts.some(
      (attempt) => attempt.deliveredAt && !attempt.browserPushSubscriptionId,
    );
    const delivered =
      channel.type !== NotificationChannelType.BROWSER_PUSH && channelAlreadyDelivered
        ? true
        : await this.deliverChannel(delivery, channel, payload, attemptNumber, deliveredSubscriptionIds);

    await this.finish(delivery, delivered, attemptNumber, delivered ? null : 'The notification channel failed.');
    if (!delivered) this.logger.warn(`Notification delivery ${delivery.id} failed.`);
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

    if (channel.recipients.length === 0) {
      await this.createAttempt(delivery.id, channel.id, attempt, false, 'Browser push recipients are missing.');
      return false;
    }
    let delivered = true;
    let recipientFailure = false;
    for (const { user } of channel.recipients) {
      try {
        const results = await this.browserPush.sendToUser(user.id, payload, deliveredSubscriptionIds);
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
          if (!result.delivered) delivered = false;
        }
      } catch {
        recipientFailure = true;
        delivered = false;
      }
    }
    if (recipientFailure)
      await this.createAttempt(delivery.id, channel.id, attempt, false, 'Browser push delivery failed.');
    return delivered;
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

  private createPayload(delivery: NotificationDeliveryModel): NotificationPayload {
    if (delivery.kind === NotificationDeliveryKind.TEST) {
      return {
        eventType: 'TEST',
        occurredAt: delivery.createdAt,
        provider: 'GITHUB',
        repository: 'ezRepo',
        subject: 'ezRepo test notification',
        subjectUrl: '',
      };
    }
    if (!delivery.eventType || !delivery.repository) throw new Error('Notification event context is missing.');
    const subject = delivery.workflowRun ?? delivery.pullRequest ?? delivery.issue;
    if (!subject) throw new Error('Notification event subject is missing.');
    return {
      eventType: delivery.eventType,
      occurredAt: delivery.workflowRun?.completedAt ?? delivery.createdAt,
      provider: delivery.repository.providerAccount.providerType,
      repository: `${delivery.repository.owner}/${delivery.repository.name}`,
      subject:
        delivery.workflowRun?.workflowName ??
        (delivery.pullRequest ? `#${delivery.pullRequest.number} ${delivery.pullRequest.title}` : undefined) ??
        (delivery.issue ? `#${delivery.issue.number} ${delivery.issue.title}` : 'Notification event'),
      subjectUrl: delivery.workflowRun?.url ?? delivery.pullRequest?.url ?? delivery.issue?.url ?? '',
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error && error.message === 'Apprise notification delivery failed.'
      ? error.message
      : 'Notification delivery failed.';
  }
}
