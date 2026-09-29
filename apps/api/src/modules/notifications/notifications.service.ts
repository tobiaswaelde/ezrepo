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
  NotificationRulePreviewDto,
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
  /**
   * Initialize NotificationsService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   * @param credentials - Service encrypting and decrypting persisted credentials.
   * @param workflowFilters - Service validating and evaluating workflow-name patterns.
   * @param deliveryService - Service executing and retrying persisted notification deliveries.
   * @param channelUrls - Service validating structured destinations and encoding Apprise URLs.
   * @param browserPush - Service managing browser push subscriptions and delivery.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialEncryptionService,
    private readonly workflowFilters: WorkflowFilterService,
    private readonly deliveryService: NotificationDeliveryService,
    private readonly channelUrls: NotificationChannelUrlService,
    private readonly browserPush: BrowserPushService,
  ) {}

  /**
   * Return every global channel to an authenticated user.
   *
   * @returns Persisted channels with subscriptions and recipient display metadata.
   */
  async listChannels() {
    return this.prisma.notificationChannel.findMany({
      include: notificationChannelInclude,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Return repositories available as optional global event filters.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @returns Repositories available to the administrator as event-subscription filters.
   * @throws ForbiddenException - System administrator access is required.
   */
  async listFilterRepositories(user: AuthenticatedUser) {
    this.assertAdmin(user);
    return this.prisma.repository.findMany({
      orderBy: [{ owner: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, owner: true },
    });
  }

  /**
   * Preview workflow subscriptions against recent persisted runs without creating deliveries.
   *
   * @param user - Authenticated user whose permissions apply to the preview.
   * @param inputs - Draft notification event subscriptions.
   * @returns Up to 20 recent matches and the completeness of the synchronized data.
   * @throws ForbiddenException - System administrator access is required.
   * @throws BadRequestException - The subscriptions are invalid or contain no workflow event.
   */
  async previewRules(
    user: AuthenticatedUser,
    inputs: NotificationEventSubscriptionInputDto[],
  ): Promise<NotificationRulePreviewDto> {
    this.assertAdmin(user);
    await this.prepareSubscriptions(inputs);
    const subscriptions = inputs
      .filter(({ eventType }) => workflowEvents.has(eventType))
      .map((input) => ({
        ...input,
        workflowPatterns: [...new Set((input.workflowPatterns ?? []).map((pattern) => pattern.trim()).filter(Boolean))],
      }));
    if (subscriptions.length === 0)
      throw new BadRequestException('At least one workflow event is required for a preview.');

    const global = subscriptions.some(({ repositoryIds }) => !repositoryIds?.length);
    const repositoryIds = global
      ? undefined
      : [...new Set(subscriptions.flatMap(({ repositoryIds: ids }) => ids ?? []))];
    const repositories = await this.prisma.repository.findMany({
      select: {
        id: true,
        lastSyncAt: true,
        name: true,
        owner: true,
        syncRequest: { select: { lastError: true } },
      },
      where: repositoryIds ? { id: { in: repositoryIds } } : undefined,
    });
    const synchronized = repositories.filter(({ lastSyncAt }) => lastSyncAt);
    const failed = repositories.filter(({ syncRequest }) => syncRequest?.lastError);
    const neverSynchronized = repositories.filter(
      ({ lastSyncAt, syncRequest }) => !lastSyncAt && !syncRequest?.lastError,
    );
    const incomplete = failed.length + neverSynchronized.length;

    let incompleteStatus: NotificationRulePreviewDto['status'] | null = null;
    if (repositories.length > 0 && synchronized.length === 0) {
      if (failed.length === repositories.length) incompleteStatus = 'SYNCHRONIZATION_FAILED';
      else if (neverSynchronized.length === repositories.length) incompleteStatus = 'NEVER_SYNCHRONIZED';
      else incompleteStatus = 'PARTIAL';
    } else if (incomplete > 0) incompleteStatus = 'PARTIAL';

    if (synchronized.length === 0) return { matches: [], status: incompleteStatus ?? 'NO_RESULTS' };
    const statuses: WorkflowRunStatus[] = [];
    if (subscriptions.some(({ eventType }) => eventType === NotificationEventType.WORKFLOW_RUN_FAILED))
      statuses.push('FAILED');
    if (subscriptions.some(({ eventType }) => eventType !== NotificationEventType.WORKFLOW_RUN_FAILED))
      statuses.push('SUCCESS');
    const runs = await this.prisma.workflowRun.findMany({
      orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        providerCreatedAt: true,
        repository: { select: { name: true, owner: true } },
        repositoryId: true,
        scopeKey: true,
        status: true,
        url: true,
        workflowId: true,
        workflowName: true,
      },
      take: 50,
      where: { repositoryId: { in: synchronized.map(({ id }) => id) }, status: { in: statuses } },
    });
    const matches: NotificationRulePreviewDto['matches'] = [];
    for (const run of runs) {
      let eventType: NotificationEventType = NotificationEventType.WORKFLOW_RUN_FAILED;
      let matchingEventTypes: NotificationEventType[] = [eventType];
      if (run.status === 'SUCCESS') {
        const previous = await this.prisma.workflowRun.findFirst({
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
        eventType =
          previous?.status === 'FAILED'
            ? NotificationEventType.WORKFLOW_RUN_RECOVERED
            : NotificationEventType.WORKFLOW_RUN_SUCCEEDED;
        matchingEventTypes =
          eventType === NotificationEventType.WORKFLOW_RUN_RECOVERED
            ? [eventType, NotificationEventType.WORKFLOW_RUN_SUCCEEDED]
            : [eventType];
      }
      const matchesSubscription = subscriptions.some(
        (subscription) =>
          matchingEventTypes.includes(subscription.eventType) &&
          (!subscription.repositoryIds?.length || subscription.repositoryIds.includes(run.repositoryId)) &&
          (!subscription.workflowPatterns?.length ||
            subscription.workflowPatterns.some((pattern) =>
              picomatch.isMatch(run.workflowName, pattern, { bash: true }),
            )),
      );
      if (!matchesSubscription) continue;
      matches.push({
        eventType,
        id: run.id,
        repositoryName: run.repository.name,
        repositoryOwner: run.repository.owner,
        url: run.url,
        workflowName: run.workflowName,
      });
      if (matches.length === 20) break;
    }
    return { matches, status: incompleteStatus ?? (matches.length > 0 ? 'MATCHES' : 'NO_RESULTS') };
  }

  /**
   * Create one global channel and its event subscriptions.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @param input - Channel name, transport settings, event subscriptions, and browser recipients.
   * @returns The persisted channel with subscriptions and recipient display metadata.
   * @throws ServiceUnavailableException - Browser push is not configured.
   * @throws ForbiddenException - System administrator access is required.
   * @throws BadRequestException - Notification events must not be repeated. One or more repository filters are invalid.
   * Workflow patterns are only supported for workflow events.
   */
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

  /**
   * Update a global channel while preserving omitted write-only credentials.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @param id - Local identifier of the target record.
   * @param input - Channel fields to replace; omitted fields, including write-only credentials, are preserved.
   * @returns The updated channel with subscriptions and recipients.
   * @throws ForbiddenException - Browser push channels do not accept destination configuration. Configure a replacement
   * Apprise URL before enabling this channel.
   * @throws NotFoundException - Notification channel not found.
   * @throws BadRequestException - Notification events must not be repeated. One or more repository filters are invalid.
   * Workflow patterns are only supported for workflow events.
   */
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

  /**
   * Delete a global channel.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @param id - Local identifier of the target record.
   * @returns A promise that resolves when the operation completes.
   * @throws ForbiddenException - System administrator access is required.
   * @throws NotFoundException - Notification channel not found.
   */
  async deleteChannel(user: AuthenticatedUser, id: string): Promise<void> {
    this.assertAdmin(user);
    await this.findChannel(id);
    await this.prisma.notificationChannel.delete({ where: { id } });
  }

  /**
   * List system-wide delivery history for system administrators.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @param repositoryId - Optional local identifier of the tracked repository.
   * @returns Delivery history with attempts and event context, ordered newest first.
   * @throws ForbiddenException - System administrator access is required.
   */
  async listDeliveryHistory(user: AuthenticatedUser, repositoryId?: string) {
    this.assertAdmin(user);
    return this.prisma.notificationDelivery.findMany({
      include: notificationDeliveryHistoryInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: repositoryId ? { repositoryId } : undefined,
    });
  }

  /**
   * Create and immediately execute one non-retrying test delivery.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @param id - Local identifier of the target record.
   * @returns The test delivery with its completed attempt history.
   * @throws ForbiddenException - System administrator access is required.
   * @throws NotFoundException - Notification channel not found.
   * @throws Error - When an event delivery lacks its repository, event type, or source work item.
   */
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

  /**
   * Classify and enqueue a terminal workflow transition after the baseline sync.
   *
   * @param run - Workflow run whose provider data or persisted state is being processed.
   * @param previousStatus - Previously persisted run status, or null for a newly discovered run.
   * @param baseline - Whether this is the initial synchronization, during which lifecycle notifications are suppressed.
   * @returns A promise that resolves when the operation completes.
   * @throws Error - When an event delivery lacks its repository, event type, or source work item.
   */
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

  /**
   * Enqueue one normalized issue lifecycle event.
   *
   * @param eventType - Normalized domain event to deliver.
   * @param issue - Issue data being normalized, persisted, or used as an event source.
   * @returns A promise that resolves when the operation completes.
   * @throws Error - When an event delivery lacks its repository, event type, or source work item.
   */
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

  /**
   * Enqueue one normalized pull-request lifecycle event.
   *
   * @param eventType - Normalized domain event to deliver.
   * @param pullRequest - Pull-request data being normalized, persisted, or used as an event source.
   * @returns A promise that resolves when the operation completes.
   * @throws Error - When an event delivery lacks its repository, event type, or source work item.
   */
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

  /**
   * Find subscribed channels and enqueue idempotent deliveries for one domain event.
   *
   * @param source - Normalized domain event, repository scope, and idempotent delivery key.
   * @returns A promise that resolves when the operation completes.
   * @throws Error - When an event delivery lacks its repository, event type, or source work item.
   */
  private async emitEvent(source: EventSource): Promise<void> {
    const channels = await this.findMatchingChannels(source);
    if (channels.length === 0) return;
    await this.createEventDeliveries(
      source,
      channels.map(({ id }) => id),
    );
  }

  /**
   * Select enabled channels whose event, repository, and workflow filters match the source.
   *
   * @param source - Normalized domain event, repository scope, and idempotent delivery key.
   * @returns Matching channel records with at least their local identifiers.
   */
  private async findMatchingChannels(source: EventSource): Promise<{ id: string }[]> {
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
    return channels.filter((channel) =>
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
  }

  /**
   * Create missing event deliveries and execute pending deliveries for the selected channels.
   *
   * @param source - Normalized domain event, repository scope, and idempotent delivery key.
   * @param channelIds - Matching notification channels that should receive the event.
   * @returns A promise that resolves when the operation completes.
   * @throws Error - When an event delivery lacks its repository, event type, or source work item.
   */
  private async createEventDeliveries(source: EventSource, channelIds: string[]): Promise<void> {
    await this.prisma.notificationDelivery.createMany({
      data: channelIds.map((channelId) => ({
        deduplicationKey: source.deduplicationKey,
        eventType: source.eventType,
        issueId: source.issueId,
        kind: NotificationDeliveryKind.EVENT,
        notificationChannelId: channelId,
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
        notificationChannelId: { in: channelIds },
        status: 'PENDING',
      },
    });
    if (deliveries.length > 0) await this.deliveryService.deliverPending(deliveries.map(({ id }) => id));
  }

  /**
   * Validate unique event subscriptions, repository filters, and workflow patterns for persistence.
   *
   * @param inputs - Requested event subscriptions to validate and prepare for persistence.
   * @returns Validated nested event-subscription data ready for Prisma persistence.
   * @throws BadRequestException - Notification events must not be repeated. One or more repository filters are invalid.
   * Workflow patterns are only supported for workflow events.
   */
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

  /**
   * Validate browser push recipient IDs and reject recipients on other channel types.
   *
   * @param type - Notification transport selected for the channel.
   * @param input - Requested browser push recipient user IDs; omission is treated as an empty list.
   * @returns Validated browser recipient IDs, or an empty list for other transports.
   * @throws BadRequestException - Only browser push channels accept browser recipients. Browser push channels require
   * at least one recipient. One or more browser recipients are invalid.
   */
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

  /**
   * Require the system administrator role before applying an administrative operation.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @returns No return value.
   * @throws ForbiddenException - System administrator access is required.
   */
  private assertAdmin(user: AuthenticatedUser): void {
    if (user.role !== 'SYSTEM_ADMIN') throw new ForbiddenException('System administrator access is required.');
  }

  /**
   * Load a notification channel or report that it no longer exists.
   *
   * @param id - Local identifier of the target record.
   * @returns The persisted notification channel.
   * @throws NotFoundException - Notification channel not found.
   */
  private async findChannel(id: string) {
    const channel = await this.prisma.notificationChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Notification channel not found.');
    return channel;
  }
}
