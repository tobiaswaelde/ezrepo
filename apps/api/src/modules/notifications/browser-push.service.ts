import { createHash } from 'node:crypto';

import { BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import * as webPush from 'web-push';

import { ENV } from '../../config/env.js';
import type { BrowserPushSubscription } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CredentialEncryptionService } from '../../security/credential-encryption.service.js';
import type { RegisterBrowserPushSubscriptionDto } from './dto/browser-push.dto.js';
import type { NotificationPayload } from './notification-channel-adapter.js';

export interface BrowserPushDeliveryResult {
  delivered: boolean;
  error: string | null;
  recordAttempt: boolean;
  subscriptionId: string;
}

/** Manages current-user browser subscriptions and native Web Push delivery. */
@Injectable()
export class BrowserPushService {
  readonly available = Boolean(
    ENV.WEB_PUSH_VAPID_PUBLIC_KEY && ENV.WEB_PUSH_VAPID_PRIVATE_KEY && ENV.WEB_PUSH_VAPID_SUBJECT,
  );

  /**
   * Initialize BrowserPushService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   * @param credentials - Service encrypting and decrypting persisted credentials.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialEncryptionService,
  ) {}

  /**
   * Return non-secret Web Push setup metadata for the current user.
   *
   * @param userId - Local user identifier targeted by the operation.
   * @returns Push availability, the non-secret public key, and the user subscription count.
   */
  async status(userId: string) {
    return {
      available: this.available,
      publicKey: this.available ? ENV.WEB_PUSH_VAPID_PUBLIC_KEY : null,
      subscriptionCount: await this.prisma.browserPushSubscription.count({ where: { userId } }),
    };
  }

  /**
   * Encrypt and upsert one PushSubscription under the authenticated user.
   *
   * @param userId - Local user identifier targeted by the operation.
   * @param input - Push endpoint and browser-generated authentication and encryption keys.
   * @returns A promise that resolves when the operation completes.
   * @throws BadRequestException - Browser push subscription keys are required.
   * @throws ForbiddenException - Browser push subscription belongs to another user.
   * @throws ServiceUnavailableException - Browser push is not configured.
   */
  async register(userId: string, input: RegisterBrowserPushSubscriptionDto): Promise<void> {
    this.assertAvailable();
    const auth = typeof input.keys.auth === 'string' ? input.keys.auth : '';
    const p256dh = typeof input.keys.p256dh === 'string' ? input.keys.p256dh : '';
    if (!auth || !p256dh) throw new BadRequestException('Browser push subscription keys are required.');
    const endpointHash = this.hashEndpoint(input.endpoint);
    const existing = await this.prisma.browserPushSubscription.findUnique({
      where: { endpointHash },
      select: { userId: true },
    });
    if (existing && existing.userId !== userId)
      throw new ForbiddenException('Browser push subscription belongs to another user.');
    const encryptedEndpoint = this.credentials.encrypt(input.endpoint);
    const encryptedAuth = this.credentials.encrypt(auth);
    const encryptedP256dh = this.credentials.encrypt(p256dh);
    await this.prisma.browserPushSubscription.upsert({
      where: { endpointHash },
      create: {
        endpointHash,
        encryptedEndpoint,
        encryptedAuth,
        encryptedP256dh,
        userId,
      },
      update: {
        encryptedEndpoint,
        encryptedAuth,
        encryptedP256dh,
      },
    });
  }

  /**
   * Remove one subscription only when it belongs to the authenticated user.
   *
   * @param userId - Local user identifier targeted by the operation.
   * @param endpoint - Push service endpoint identifying a browser subscription.
   * @returns A promise that resolves when the operation completes.
   */
  async remove(userId: string, endpoint: string): Promise<void> {
    await this.prisma.browserPushSubscription.deleteMany({
      where: { endpointHash: this.hashEndpoint(endpoint), userId },
    });
  }

  /**
   * Deliver to all current subscriptions, excluding devices already delivered for this delivery.
   *
   * @param userId - Local user identifier targeted by the operation.
   * @param payload - Notification content shared across delivery transports.
   * @param deliveredSubscriptionIds - Device subscriptions already delivered successfully and excluded from retries.
   * @returns Delivery outcomes for the remaining registered browser subscriptions.
   * @throws ServiceUnavailableException - No browser push subscriptions are registered.
   */
  async sendToUser(userId: string, payload: NotificationPayload, deliveredSubscriptionIds: Set<string>) {
    this.assertAvailable();
    const subscriptions = await this.prisma.browserPushSubscription.findMany({
      where: { userId, id: { notIn: [...deliveredSubscriptionIds] } },
    });
    if (subscriptions.length === 0 && deliveredSubscriptionIds.size === 0)
      throw new ServiceUnavailableException('No browser push subscriptions are registered.');
    return Promise.all(subscriptions.map((subscription) => this.send(subscription, payload)));
  }

  /**
   * Send one browser notification and retire subscriptions rejected as expired by the push provider.
   *
   * @param subscription - Persisted browser subscription with encrypted endpoint and keys.
   * @param payload - Notification content shared across delivery transports.
   * @returns The per-subscription delivery outcome and whether an attempt should be recorded.
   */
  private async send(
    subscription: BrowserPushSubscription,
    payload: NotificationPayload,
  ): Promise<BrowserPushDeliveryResult> {
    try {
      await webPush.sendNotification(
        {
          endpoint: this.credentials.decrypt(subscription.encryptedEndpoint),
          keys: {
            auth: this.credentials.decrypt(subscription.encryptedAuth),
            p256dh: this.credentials.decrypt(subscription.encryptedP256dh),
          },
        },
        JSON.stringify({
          body: `${payload.repository}\n${payload.subject}`,
          title: payload.eventType,
          url: payload.subjectUrl,
        }),
        {
          TTL: 60 * 60,
          vapidDetails: {
            privateKey: ENV.WEB_PUSH_VAPID_PRIVATE_KEY,
            publicKey: ENV.WEB_PUSH_VAPID_PUBLIC_KEY,
            subject: ENV.WEB_PUSH_VAPID_SUBJECT,
          },
        },
      );
      return { delivered: true, error: null, recordAttempt: true, subscriptionId: subscription.id };
    } catch (error) {
      if (error instanceof webPush.WebPushError && [404, 410].includes(error.statusCode)) {
        await this.prisma.browserPushSubscription.delete({ where: { id: subscription.id } });
        return { delivered: true, error: null, recordAttempt: false, subscriptionId: subscription.id };
      }
      return {
        delivered: false,
        error: 'Browser push delivery failed.',
        recordAttempt: true,
        subscriptionId: subscription.id,
      };
    }
  }

  /**
   * Require a complete VAPID configuration before using browser push.
   *
   * @returns No return value.
   * @throws ServiceUnavailableException - Browser push is not configured.
   */
  private assertAvailable(): void {
    if (!this.available) throw new ServiceUnavailableException('Browser push is not configured.');
  }

  /**
   * Hash a push endpoint for lookup without exposing the endpoint URL.
   *
   * @param endpoint - Push service endpoint identifying a browser subscription.
   * @returns The lowercase hexadecimal SHA-256 endpoint digest.
   */
  private hashEndpoint(endpoint: string): string {
    return createHash('sha256').update(endpoint).digest('hex');
  }
}
