import type { NotificationChannel, NotificationEventType, ProviderType } from '../../generated/prisma/client.js';

/** Provider and workflow context included in every outbound notification. */
export interface NotificationPayload {
  eventType: NotificationEventType | 'TEST';
  occurredAt: Date;
  provider: ProviderType;
  repository: string;
  subject: string;
  subjectUrl: string;
}

/** A read-only configured Apprise notification destination. */
export interface NotificationChannelAdapter {
  /**
   * Send one structured workflow notification through its configured channel.
   *
   * @param channel - Persisted notification destination and required transport configuration.
   * @param payload - Notification content shared across delivery transports.
   * @returns A promise that resolves when the operation completes.
   */
  send(channel: NotificationChannel, payload: NotificationPayload): Promise<void>;
}

/**
 * Render the stable human-readable body shared by every notification transport.
 *
 * @param payload - Notification content shared across delivery transports.
 * @returns The plain-text notification body sent to Apprise.
 */
export function formatNotificationMessage(payload: NotificationPayload): string {
  return [
    `Provider: ${payload.provider}`,
    `Repository: ${payload.repository}`,
    `Event: ${payload.eventType}`,
    `Subject: ${payload.subject}`,
    `Occurred: ${payload.occurredAt.toISOString()}`,
    `Link: ${payload.subjectUrl}`,
  ].join('\n');
}
