import { BadRequestException, Injectable } from '@nestjs/common';

import { NotificationChannelType } from '../../generated/prisma/client.js';
import type {
  CustomAppriseNotificationConfigurationInput,
  DiscordNotificationConfigurationInput,
  EmailNotificationConfigurationInput,
  GotifyNotificationConfigurationInput,
  NotificationConfigurationInput,
  NtfyNotificationConfigurationInput,
} from './dto/notification-channel.dto.js';

interface PreparedNotificationUrl {
  scheme: string;
  value: string;
}

/** Validates structured channel configuration and creates one canonical Apprise URL. */
@Injectable()
export class NotificationChannelUrlService {
  /** Create an Apprise URL for the selected transport type. */
  prepare(
    type: NotificationChannelType,
    configuration?: NotificationConfigurationInput,
  ): PreparedNotificationUrl | null {
    if (type === NotificationChannelType.BROWSER_PUSH) {
      if (configuration !== undefined)
        throw new BadRequestException('Browser push channels do not accept configuration.');
      return null;
    }
    if (!configuration) throw new BadRequestException('Notification channel configuration is required.');

    switch (type) {
      case NotificationChannelType.EMAIL:
        return this.prepareEmail(configuration as EmailNotificationConfigurationInput);
      case NotificationChannelType.GOTIFY:
        return this.prepareGotify(configuration as GotifyNotificationConfigurationInput);
      case NotificationChannelType.NTFY:
        return this.prepareNtfy(configuration as NtfyNotificationConfigurationInput);
      case NotificationChannelType.DISCORD:
        return this.prepareDiscord(configuration as DiscordNotificationConfigurationInput);
      case NotificationChannelType.CUSTOM_APPRISE:
        return this.prepareCustom(configuration as CustomAppriseNotificationConfigurationInput);
      default:
        throw new BadRequestException('Unsupported notification channel type.');
    }
  }

  private prepareEmail(input: EmailNotificationConfigurationInput): PreparedNotificationUrl {
    const smtpHost = this.requiredString(input.smtpHost, 'SMTP host');
    const from = this.requiredEmail(input.from, 'From address');
    if (!Array.isArray(input.recipients) || input.recipients.length === 0)
      throw new BadRequestException('At least one email recipient is required.');
    const recipients = input.recipients.map((recipient) => this.requiredEmail(recipient, 'Recipient'));
    if (!['NONE', 'STARTTLS', 'TLS'].includes(input.security))
      throw new BadRequestException('Select a valid email security mode.');
    if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535))
      throw new BadRequestException('Email port must be between 1 and 65535.');

    const protocol = input.security === 'NONE' ? 'mailto:' : 'mailtos:';
    const url = new URL(`${protocol}//${smtpHost}${input.port ? `:${input.port}` : ''}`);
    url.searchParams.set('smtp', smtpHost);
    url.searchParams.set('from', from);
    url.searchParams.set('to', recipients.join(','));
    if (input.username) url.searchParams.set('user', input.username.trim());
    if (input.password) url.searchParams.set('pass', input.password);
    if (input.security === 'TLS') url.searchParams.set('mode', 'ssl');
    return { scheme: protocol.slice(0, -1), value: url.toString() };
  }

  private prepareGotify(input: GotifyNotificationConfigurationInput): PreparedNotificationUrl {
    const server = this.httpUrl(input.serverUrl, 'Gotify server URL');
    const token = this.requiredString(input.token, 'Gotify application token');
    const protocol = server.protocol === 'https:' ? 'gotifys:' : 'gotify:';
    const path = `${server.pathname.replace(/\/$/, '')}/${encodeURIComponent(token)}`;
    const url = new URL(`${protocol}//${server.host}${path}`);
    if (input.priority) url.searchParams.set('priority', input.priority);
    return { scheme: protocol.slice(0, -1), value: url.toString() };
  }

  private prepareNtfy(input: NtfyNotificationConfigurationInput): PreparedNotificationUrl {
    const topic = this.requiredString(input.topic, 'ntfy topic');
    const server = this.httpUrl(input.serverUrl || 'https://ntfy.sh', 'ntfy server URL');
    const protocol = server.protocol === 'https:' ? 'ntfys:' : 'ntfy:';
    const path = `${server.pathname.replace(/\/$/, '')}/${encodeURIComponent(topic)}`;
    const url = new URL(`${protocol}//${server.host}${path}`);
    if (input.username) url.searchParams.set('user', input.username.trim());
    if (input.password) url.searchParams.set('pass', input.password);
    if (input.token) url.searchParams.set('token', input.token);
    if (input.priority) url.searchParams.set('priority', input.priority);
    return { scheme: protocol.slice(0, -1), value: url.toString() };
  }

  private prepareDiscord(input: DiscordNotificationConfigurationInput): PreparedNotificationUrl {
    const webhook = this.httpUrl(input.webhookUrl, 'Discord webhook URL');
    if (
      !['discord.com', 'discordapp.com'].some(
        (domain) => webhook.hostname === domain || webhook.hostname.endsWith(`.${domain}`),
      )
    )
      throw new BadRequestException('Provide a Discord webhook URL.');
    const match = webhook.pathname.match(/\/api\/webhooks\/([^/]+)\/([^/]+)/);
    if (!match) throw new BadRequestException('Provide a Discord webhook URL.');
    return { scheme: 'discord', value: `discord://${encodeURIComponent(match[1]!)}/${encodeURIComponent(match[2]!)}` };
  }

  private prepareCustom(input: CustomAppriseNotificationConfigurationInput): PreparedNotificationUrl {
    const value = this.requiredString(input.url, 'Apprise notification URL');
    if (/\s/.test(value)) throw new BadRequestException('Provide a valid Apprise notification URL.');
    try {
      const parsed = new URL(value);
      const scheme = parsed.protocol.slice(0, -1).toLowerCase();
      if (!scheme || scheme === 'file') throw new Error('invalid scheme');
      return { scheme, value };
    } catch {
      throw new BadRequestException('Provide a valid Apprise notification URL.');
    }
  }

  private requiredString(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${label} is required.`);
    return value.trim();
  }

  private requiredEmail(value: unknown, label: string): string {
    const email = this.requiredString(value, label);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException(`${label} must be an email address.`);
    return email;
  }

  private httpUrl(value: unknown, label: string): URL {
    try {
      const url = new URL(this.requiredString(value, label));
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid protocol');
      return url;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`${label} must use http or https.`);
    }
  }
}
