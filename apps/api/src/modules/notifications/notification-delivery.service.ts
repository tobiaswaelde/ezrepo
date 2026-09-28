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

/**
 * Return the bounded exponential delay before a subsequent delivery attempt.
 *
 * @param attempt - One-based delivery or synchronization attempt number.
 * @returns The capped exponential retry delay in milliseconds.
 */
export function notificationRetryDelayMs(attempt: number): number {
  return Math.min(60_000 * 2 ** Math.max(attempt - 1, 0), 60 * 60_000);
}

/** Sends pending notification deliveries through Apprise or native browser push. */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  /**
   * Initialize NotificationDeliveryService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   * @param jobs - Runner that prevents overlapping background jobs and disables them in tests.
   * @param apprise - Adapter sending notifications through the configured Apprise endpoint.
   * @param browserPush - Service managing browser push subscriptions and delivery.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobRunnerService,
    private readonly apprise: AppriseNotificationAdapter,
    private readonly browserPush: BrowserPushService,
  ) {}

  /**
   * Retry delivery records whose bounded exponential delay has elapsed.
   *
   * @returns A promise that resolves when the operation completes.
   */
  @Interval(60_000)
  async scheduleRetries(): Promise<void> {
    await this.jobs.run('notification-delivery-retry', () => this.deliverPending());
  }

  /**
   * Attempt every requested pending delivery once, retaining an immutable attempt audit trail.
   *
   * @param deliveryIds - Optional delivery identifiers restricting the pending work to execute.
   * @returns A promise that resolves when the operation completes.
   * @throws Error - When an event delivery lacks its repository, event type, or source work item.
   */
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

  /**
   * Attempt a pending delivery while preserving successful targets from earlier attempts.
   *
   * @param delivery - Persisted delivery with its channel, source, and prior attempts.
   * @returns A promise that resolves when the operation completes.
   * @throws Error - When an event delivery lacks its repository, event type, or source work item.
   */
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

  /**
   * Dispatch one delivery through its configured notification transport.
   *
   * @param delivery - Persisted delivery with its channel, source, and prior attempts.
   * @param channel - Persisted notification destination and required transport configuration.
   * @param payload - Notification content shared across delivery transports.
   * @param attempt - One-based delivery or synchronization attempt number.
   * @param deliveredSubscriptionIds - Device subscriptions already delivered successfully and excluded from retries.
   * @returns Whether delivery succeeded for all remaining required targets.
   */
  private async deliverChannel(
    delivery: NotificationDeliveryModel,
    channel: DeliveryChannel,
    payload: NotificationPayload,
    attempt: number,
    deliveredSubscriptionIds: Set<string>,
  ): Promise<boolean> {
    return channel.type === NotificationChannelType.BROWSER_PUSH
      ? this.deliverBrowserPush(delivery, channel, payload, attempt, deliveredSubscriptionIds)
      : this.deliverApprise(delivery, channel, payload, attempt);
  }

  /**
   * Send an Apprise notification and persist the successful or failed attempt.
   *
   * @param delivery - Persisted delivery with its channel, source, and prior attempts.
   * @param channel - Persisted notification destination and required transport configuration.
   * @param payload - Notification content shared across delivery transports.
   * @param attempt - One-based delivery or synchronization attempt number.
   * @returns Whether the Apprise send and successful attempt recording completed.
   */
  private async deliverApprise(
    delivery: NotificationDeliveryModel,
    channel: DeliveryChannel,
    payload: NotificationPayload,
    attempt: number,
  ): Promise<boolean> {
    try {
      await this.apprise.send(channel, payload);
      await this.createAttempt(delivery.id, channel.id, attempt, true);
      return true;
    } catch (error) {
      await this.createAttempt(delivery.id, channel.id, attempt, false, this.errorMessage(error));
      return false;
    }
  }

  /**
   * Send browser push notifications to remaining recipients and record per-device outcomes.
   *
   * @param delivery - Persisted delivery with its channel, source, and prior attempts.
   * @param channel - Persisted notification destination and required transport configuration.
   * @param payload - Notification content shared across delivery transports.
   * @param attempt - One-based delivery or synchronization attempt number.
   * @param deliveredSubscriptionIds - Device subscriptions already delivered successfully and excluded from retries.
   * @returns Whether all remaining browser targets were delivered without recipient failures.
   */
  private async deliverBrowserPush(
    delivery: NotificationDeliveryModel,
    channel: DeliveryChannel,
    payload: NotificationPayload,
    attempt: number,
    deliveredSubscriptionIds: Set<string>,
  ): Promise<boolean> {
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

  /**
   * Persist one immutable notification attempt with a sanitized outcome.
   *
   * @param deliveryId - Local identifier of the notification delivery.
   * @param channelId - Local identifier of the notification channel.
   * @param attempt - One-based delivery or synchronization attempt number.
   * @param delivered - Whether the notification reached all required targets.
   * @param error - Failure to classify or sanitized message to persist.
   * @param subscriptionId - Optional browser subscription associated with this attempt.
   * @returns A promise that resolves when the operation completes.
   */
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

  /**
   * Mark a delivery complete, schedule its retry, or record terminal failure.
   *
   * @param delivery - Persisted delivery with its channel, source, and prior attempts.
   * @param delivered - Whether the notification reached all required targets.
   * @param attemptNumber - One-based attempt number used to determine retry exhaustion.
   * @param error - Sanitized final failure message, or null after successful delivery.
   * @returns A promise that resolves when the operation completes.
   */
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

  /**
   * Build the transport-neutral payload for a test or persisted notification event.
   *
   * @param delivery - Persisted delivery with its channel, source, and prior attempts.
   * @returns The normalized notification content for the configured transport.
   * @throws Error - When an event delivery lacks its repository, event type, or source work item.
   */
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

  /**
   * Return a notification failure message that does not expose destination credentials.
   *
   * @param error - Caught transport error whose message must be sanitized before persistence.
   * @returns A sanitized notification failure message.
   */
  private errorMessage(error: unknown): string {
    return error instanceof Error && error.message === 'Apprise notification delivery failed.'
      ? error.message
      : 'Notification delivery failed.';
  }
}
