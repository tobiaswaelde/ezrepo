import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Injectable } from '@nestjs/common';

import type { NotificationChannel } from '../../generated/prisma/client.js';
import { CredentialEncryptionService } from '../../security/credential-encryption.service.js';
import {
  formatNotificationMessage,
  type NotificationChannelAdapter,
  type NotificationPayload,
} from './notification-channel-adapter.js';

const execFileAsync = promisify(execFile);

/** Delivers encrypted Apprise notification URLs without exposing them in process arguments. */
@Injectable()
export class AppriseNotificationAdapter implements NotificationChannelAdapter {
  /**
   * Initialize AppriseNotificationAdapter with its required dependencies.
   *
   * @param credentials - Service encrypting and decrypting persisted credentials.
   */
  constructor(private readonly credentials: CredentialEncryptionService) {}

  /**
   * Send one workflow status message through Apprise.
   *
   * @param channel - Persisted notification destination and required transport configuration.
   * @param payload - Notification content shared across delivery transports.
   * @returns A promise that resolves when the operation completes.
   * @throws Error - Apprise notification delivery failed.
   */
  async send(channel: NotificationChannel, payload: NotificationPayload): Promise<void> {
    if (!channel.encryptedUrl) throw new Error('Apprise notification delivery failed.');

    const directory = await mkdtemp(join(tmpdir(), 'ezrepo-apprise-'));
    const configurationPath = join(directory, 'channel.conf');
    try {
      await writeFile(configurationPath, `${this.credentials.decrypt(channel.encryptedUrl)}\n`, { mode: 0o600 });
      await execFileAsync(
        'apprise',
        [
          '--config',
          configurationPath,
          '--title',
          `${payload.eventType}: ${payload.subject}`,
          '--body',
          formatNotificationMessage(payload),
          '--notification-type',
          payload.eventType.endsWith('FAILED') ? 'failure' : 'success',
        ],
        { timeout: 30_000 },
      );
    } catch {
      throw new Error('Apprise notification delivery failed.');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
}
