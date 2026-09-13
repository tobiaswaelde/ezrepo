import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import picomatch from 'picomatch';

import {
  NotificationChannelType,
  NotificationDeliveryKind,
  NotificationEventType,
  type Prisma,
  type WorkflowRunStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CredentialEncryptionService } from '../../security/credential-encryption.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { WorkflowFilterService } from '../repositories/workflow-filter.service.js';
import { BrowserPushService } from './browser-push.service.js';
import type {
  CreateNotificationChannelDto,
  NotificationEventSubscriptionInputDto,
  UpdateNotificationChannelDto,
} from './dto/notification-channel.dto.js';
import { NotificationChannelUrlService } from './notification-channel-url.service.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';

export const notificationChannelInclude = {
  eventSubscriptions: {
    include: { repositories: { select: { repositoryId: true } } },
    orderBy: { eventType: 'asc' },
  },
  recipients: { include: { user: { select: { id: true, username: true } } } },
} satisfies Prisma.NotificationChannelInclude;

export const notificationDeliveryHistoryInclude = {
  attempts: {
    include: {
      browserPushSubscription: { select: { id: true } },
      notificationChannel: { select: { name: true, type: true } },
    },
    orderBy: { createdAt: 'desc' },
  },
  issue: { select: { id: true, number: true, title: true, url: true } },
  notificationChannel: { select: { id: true, name: true, type: true } },
  pullRequest: { select: { id: true, number: true, title: true, url: true } },
  repository: { select: { id: true, name: true, owner: true } },
  requestedBy: { select: { username: true } },
  workflowRun: { select: { id: true, url: true, workflowName: true } },
} satisfies Prisma.NotificationDeliveryInclude;

const workflowEvents = new Set<NotificationEventType>([
  NotificationEventType.WORKFLOW_RUN_FAILED,
  NotificationEventType.WORKFLOW_RUN_RECOVERED,
  NotificationEventType.WORKFLOW_RUN_SUCCEEDED,
]);

interface EventSource {
  deduplicationKey: string;
  eventType: NotificationEventType;
  issueId?: string;
  matchingEventTypes?: NotificationEventType[];
  pullRequestId?: string;
  repositoryId: string;
  workflowName?: string;
  workflowRunId?: string;
}

/** Manages global notification destinations, subscriptions, and idempotent event deliveries. */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialEncryptionService,
    private readonly workflowFilters: WorkflowFilterService,
    private readonly deliveryService: NotificationDeliveryService,
    private readonly channelUrls: NotificationChannelUrlService,
    private readonly browserPush: BrowserPushService,
  ) {}

  /** Return every global channel to an authenticated user. */
  async listChannels() {
    return this.prisma.notificationChannel.findMany({
      include: notificationChannelInclude,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  /** Return repositories available as optional global event filters. */
  async listFilterRepositories(user: AuthenticatedUser) {
    this.assertAdmin(user);
    return this.prisma.repository.findMany({
      orderBy: [{ owner: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, owner: true },
    });
  }

  /** Create one global channel and its event subscriptions. */
  async createChannel(user: AuthenticatedUser, input: CreateNotificationChannelDto) {
    this.assertAdmin(user);
    const type = input.type ?? NotificationChannelType.CUSTOM_APPRISE;
    if (type === NotificationChannelType.BROWSER_PUSH && !this.browserPush.available)
      throw new ServiceUnavailableException('Browser push is not configured.');
    const subscriptions = await this.prepareSubscriptions(input.eventSubscriptions);
    const recipientIds = await this.prepareRecipients(type, input.browserRecipientUserIds);
    const configuration = input.configuration ?? (input.url ? { url: input.url } : undefined);
    const url = this.channelUrls.prepare(type, configuration);
    return this.prisma.notificationChannel.create({
      data: {
        name: input.name.trim(),
        type,
        enabled: input.enabled ?? true,
        encryptedUrl: url ? this.credentials.encrypt(url.value) : null,
        urlScheme: url?.scheme ?? 'browser-push',
        requiresReconfiguration: false,
        eventSubscriptions: { create: subscriptions },
        recipients: { createMany: { data: recipientIds.map((userId) => ({ userId })) } },
      },
      include: notificationChannelInclude,
    });
  }

  /** Update a global channel while preserving omitted write-only credentials. */
  async updateChannel(user: AuthenticatedUser, id: string, input: UpdateNotificationChannelDto) {
    this.assertAdmin(user);
    const channel = await this.findChannel(id);
    const subscriptions = input.eventSubscriptions
      ? await this.prepareSubscriptions(input.eventSubscriptions)
      : undefined;
    const recipientIds =
      input.browserRecipientUserIds === undefined
        ? undefined
        : await this.prepareRecipients(channel.type, input.browserRecipientUserIds);
    const configuration = input.configuration ?? (input.url ? { url: input.url } : undefined);
    const url = configuration === undefined ? undefined : this.channelUrls.prepare(channel.type, configuration);
    if (url === null) throw new ForbiddenException('Browser push channels do not accept destination configuration.');
    if (input.enabled && channel.requiresReconfiguration && url === undefined)
      throw new ForbiddenException('Configure a replacement Apprise URL before enabling this channel.');

    return this.prisma.notificationChannel.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(url === undefined
          ? {}
          : {
              encryptedUrl: this.credentials.encrypt(url.value),
              requiresReconfiguration: false,
              urlScheme: url.scheme,
            }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(subscriptions === undefined ? {} : { eventSubscriptions: { create: subscriptions, deleteMany: {} } }),
        ...(recipientIds === undefined
          ? {}
          : { recipients: { createMany: { data: recipientIds.map((userId) => ({ userId })) }, deleteMany: {} } }),
      },
      include: notificationChannelInclude,
    });
  }

  /** Delete a global channel. */
  async deleteChannel(user: AuthenticatedUser, id: string): Promise<void> {
    this.assertAdmin(user);
    await this.findChannel(id);
    await this.prisma.notificationChannel.delete({ where: { id } });
  }

  /** List system-wide delivery history for system administrators. */
  async listDeliveryHistory(user: AuthenticatedUser, repositoryId?: string) {
    this.assertAdmin(user);
    return this.prisma.notificationDelivery.findMany({
      include: notificationDeliveryHistoryInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: repositoryId ? { repositoryId } : undefined,
    });
  }

  /** Create and immediately execute one non-retrying test delivery. */
  async testChannel(user: AuthenticatedUser, id: string) {
    this.assertAdmin(user);
    const channel = await this.findChannel(id);
    const delivery = await this.prisma.notificationDelivery.create({
      data: {
        deduplicationKey: `test:${crypto.randomUUID()}`,
        kind: NotificationDeliveryKind.TEST,
        notificationChannelId: channel.id,
        requestedByUserId: user.id,
      },
      select: { id: true },
    });
    await this.deliveryService.deliverPending([delivery.id]);
    return this.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
      include: notificationDeliveryHistoryInclude,
    });
  }

  /** Classify and enqueue a terminal workflow transition after the baseline sync. */
  async evaluateWorkflowRun(
    run: {
      id: string;
      repositoryId: string;
      status: WorkflowRunStatus;
      workflowId: string;
      workflowName: string;
      scopeKey: string;
      providerCreatedAt: Date;
    },
    previousStatus: WorkflowRunStatus | null,
    baseline: boolean,
  ): Promise<void> {
    if (baseline || previousStatus === run.status || !['SUCCESS', 'FAILED'].includes(run.status)) return;
    if (run.status === 'FAILED') {
      await this.emitEvent({
        deduplicationKey: `workflow:${run.id}:failed`,
        eventType: NotificationEventType.WORKFLOW_RUN_FAILED,
        repositoryId: run.repositoryId,
        workflowName: run.workflowName,
        workflowRunId: run.id,
      });
      return;
    }

    const previousTerminalRun = await this.prisma.workflowRun.findFirst({
      orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
      select: { status: true },
      where: {
        id: { not: run.id },
        providerCreatedAt: { lte: run.providerCreatedAt },
        scopeKey: run.scopeKey,
        status: { in: ['SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED', 'UNKNOWN'] },
        workflowId: run.workflowId,
      },
    });
    const recovered = previousTerminalRun?.status === 'FAILED';
    await this.emitEvent({
      deduplicationKey: `workflow:${run.id}:${recovered ? 'recovered' : 'succeeded'}`,
      eventType: recovered
        ? NotificationEventType.WORKFLOW_RUN_RECOVERED
        : NotificationEventType.WORKFLOW_RUN_SUCCEEDED,
      matchingEventTypes: recovered
        ? [NotificationEventType.WORKFLOW_RUN_RECOVERED, NotificationEventType.WORKFLOW_RUN_SUCCEEDED]
        : undefined,
      repositoryId: run.repositoryId,
      workflowName: run.workflowName,
      workflowRunId: run.id,
    });
  }

  /** Enqueue one normalized issue lifecycle event. */
  async emitIssueEvent(
    eventType: NotificationEventType,
    issue: { id: string; providerUpdatedAt: Date; repositoryId: string },
  ): Promise<void> {
    await this.emitEvent({
      deduplicationKey: `issue:${issue.id}:${eventType}:${issue.providerUpdatedAt.toISOString()}`,
      eventType,
      issueId: issue.id,
      repositoryId: issue.repositoryId,
    });
  }

  /** Enqueue one normalized pull-request lifecycle event. */
  async emitPullRequestEvent(
    eventType: NotificationEventType,
    pullRequest: { id: string; providerUpdatedAt: Date; repositoryId: string },
  ): Promise<void> {
    await this.emitEvent({
      deduplicationKey: `pull-request:${pullRequest.id}:${eventType}:${pullRequest.providerUpdatedAt.toISOString()}`,
      eventType,
      pullRequestId: pullRequest.id,
      repositoryId: pullRequest.repositoryId,
    });
  }

  private async emitEvent(source: EventSource): Promise<void> {
    const matchingEventTypes = source.matchingEventTypes ?? [source.eventType];
    const channels = await this.prisma.notificationChannel.findMany({
      include: {
        eventSubscriptions: {
          include: { repositories: { select: { repositoryId: true } } },
          where: { eventType: { in: matchingEventTypes } },
        },
      },
      where: {
        enabled: true,
        eventSubscriptions: {
          some: {
            eventType: { in: matchingEventTypes },
            OR: [{ repositories: { none: {} } }, { repositories: { some: { repositoryId: source.repositoryId } } }],
          },
        },
      },
    });
    const matchingChannels = channels.filter((channel) =>
      channel.eventSubscriptions.some(
        (subscription) =>
          (subscription.repositories.length === 0 ||
            subscription.repositories.some(({ repositoryId }) => repositoryId === source.repositoryId)) &&
          (!source.workflowName ||
            subscription.workflowPatterns.length === 0 ||
            subscription.workflowPatterns.some((pattern) =>
              picomatch.isMatch(source.workflowName as string, pattern, { bash: true }),
            )),
      ),
    );
    if (matchingChannels.length === 0) return;

    await this.prisma.notificationDelivery.createMany({
      data: matchingChannels.map((channel) => ({
        deduplicationKey: source.deduplicationKey,
        eventType: source.eventType,
        issueId: source.issueId,
        kind: NotificationDeliveryKind.EVENT,
        notificationChannelId: channel.id,
        pullRequestId: source.pullRequestId,
        repositoryId: source.repositoryId,
        workflowRunId: source.workflowRunId,
      })),
      skipDuplicates: true,
    });
    const deliveries = await this.prisma.notificationDelivery.findMany({
      select: { id: true },
      where: {
        deduplicationKey: source.deduplicationKey,
        notificationChannelId: { in: matchingChannels.map(({ id }) => id) },
        status: 'PENDING',
      },
    });
    if (deliveries.length > 0) await this.deliveryService.deliverPending(deliveries.map(({ id }) => id));
  }

  private async prepareSubscriptions(inputs: NotificationEventSubscriptionInputDto[]) {
    const eventTypes = inputs.map(({ eventType }) => eventType);
    if (new Set(eventTypes).size !== eventTypes.length)
      throw new BadRequestException('Notification events must not be repeated.');
    const repositoryIds = [...new Set(inputs.flatMap(({ repositoryIds }) => repositoryIds ?? []))];
    if (repositoryIds.length > 0) {
      const count = await this.prisma.repository.count({ where: { id: { in: repositoryIds } } });
      if (count !== repositoryIds.length) throw new BadRequestException('One or more repository filters are invalid.');
    }
    return inputs.map((input) => {
      const patterns = [...new Set((input.workflowPatterns ?? []).map((pattern) => pattern.trim()).filter(Boolean))];
      if (!workflowEvents.has(input.eventType) && patterns.length > 0)
        throw new BadRequestException('Workflow patterns are only supported for workflow events.');
      for (const pattern of patterns) this.workflowFilters.validatePattern(pattern);
      return {
        eventType: input.eventType,
        workflowPatterns: patterns,
        repositories: {
          createMany: { data: (input.repositoryIds ?? []).map((repositoryId) => ({ repositoryId })) },
        },
      };
    });
  }

  private async prepareRecipients(type: NotificationChannelType, input: string[] | undefined): Promise<string[]> {
    const recipientIds = input ?? [];
    if (type !== NotificationChannelType.BROWSER_PUSH) {
      if (recipientIds.length > 0)
        throw new BadRequestException('Only browser push channels accept browser recipients.');
      return [];
    }
    if (recipientIds.length === 0)
      throw new BadRequestException('Browser push channels require at least one recipient.');
    const count = await this.prisma.user.count({ where: { id: { in: recipientIds } } });
    if (count !== recipientIds.length) throw new BadRequestException('One or more browser recipients are invalid.');
    return recipientIds;
  }

  private assertAdmin(user: AuthenticatedUser): void {
    if (user.role !== 'SYSTEM_ADMIN') throw new ForbiddenException('System administrator access is required.');
  }

  private async findChannel(id: string) {
    const channel = await this.prisma.notificationChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Notification channel not found.');
    return channel;
  }
}
