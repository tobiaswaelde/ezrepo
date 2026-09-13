import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import picomatch from 'picomatch';

import { CaslAbilityFactory } from '../../casl/casl-ability.factory.js';
import { CaslAction } from '../../casl/casl-action.js';
import { accessibleBy } from '../../casl/casl-prisma.js';
import { CaslSubject } from '../../casl/casl-subject.js';
import { NotificationChannelType, NotificationDeliveryKind, type Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CredentialEncryptionService } from '../../security/credential-encryption.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { WorkflowFilterService } from '../repositories/workflow-filter.service.js';
import { BrowserPushService } from './browser-push.service.js';
import type { CreateNotificationChannelDto, UpdateNotificationChannelDto } from './dto/notification-channel.dto.js';
import type { CreateNotificationRuleDto, UpdateNotificationRuleDto } from './dto/notification-rule.dto.js';
import { NotificationChannelUrlService } from './notification-channel-url.service.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';

const notificationChannelInclude = {
  browserRecipient: { select: { id: true, username: true } },
} satisfies Prisma.NotificationChannelInclude;

const notificationRuleInclude = {
  channelLinks: { select: { notificationChannelId: true } },
} satisfies Prisma.NotificationRuleInclude;

const notificationDeliveryHistoryInclude = {
  attempts: {
    include: {
      notificationChannel: { select: { name: true, type: true } },
      browserPushSubscription: { select: { id: true } },
    },
    orderBy: { createdAt: 'desc' },
  },
  notificationRule: {
    select: { outcome: true, repository: { select: { id: true, name: true, owner: true } }, workflowPattern: true },
  },
  testChannel: { select: { name: true, repository: { select: { id: true, name: true, owner: true } } } },
  workflowRun: { select: { id: true, url: true, workflowName: true } },
  requestedBy: { select: { username: true } },
} satisfies Prisma.NotificationDeliveryInclude;

/** Manages repository-scoped notification channel records without exposing secrets. */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abilityFactory: CaslAbilityFactory,
    private readonly credentials: CredentialEncryptionService,
    private readonly workflowFilters: WorkflowFilterService,
    private readonly deliveryService: NotificationDeliveryService,
    private readonly channelUrls: NotificationChannelUrlService,
    private readonly browserPush: BrowserPushService,
  ) {}

  /** Return channels that belong to repositories visible to the current user. */
  async listChannels(user: AuthenticatedUser, repositoryId?: string) {
    const ability = await this.getAbility(user);
    const accessibleWhere = accessibleBy(ability, CaslAction.Read).ofType(
      CaslSubject.NotificationChannel as never,
    ) as Prisma.NotificationChannelWhereInput;
    return this.prisma.notificationChannel.findMany({
      include: notificationChannelInclude,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      where: {
        AND: [accessibleWhere, ...(repositoryId ? [{ repositoryId }] : [])],
      },
    });
  }

  /** Return repositories for which the caller may create notification configuration. */
  async listManageableRepositories(user: AuthenticatedUser) {
    if (user.role === 'SYSTEM_ADMIN') {
      return this.prisma.repository.findMany({
        orderBy: [{ owner: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, owner: true },
      });
    }
    if (user.role !== 'MANAGER') return [];
    return this.prisma.repository.findMany({
      orderBy: [{ owner: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, owner: true },
      where: { memberships: { some: { role: 'MANAGER', userId: user.id } } },
    });
  }

  /** Create one channel for a repository the caller can manage. */
  async createChannel(user: AuthenticatedUser, input: CreateNotificationChannelDto) {
    await this.assertCanManageRepository(user, input.repositoryId);
    const type = input.type ?? NotificationChannelType.CUSTOM_APPRISE;
    if (type === NotificationChannelType.BROWSER_PUSH && !this.browserPush.available)
      throw new ServiceUnavailableException('Browser push is not configured.');
    const configuration = input.configuration ?? (input.url ? { url: input.url } : undefined);
    const url = this.channelUrls.prepare(type, configuration);
    return this.prisma.notificationChannel.create({
      data: {
        repositoryId: input.repositoryId,
        name: input.name.trim(),
        type,
        enabled: input.enabled ?? true,
        encryptedUrl: url ? this.credentials.encrypt(url.value) : null,
        urlScheme: url?.scheme ?? 'browser-push',
        browserRecipientUserId: type === NotificationChannelType.BROWSER_PUSH ? user.id : null,
        requiresReconfiguration: false,
      },
      include: notificationChannelInclude,
    });
  }

  /** Update a channel after resolving its repository-scoped management access. */
  async updateChannel(user: AuthenticatedUser, id: string, input: UpdateNotificationChannelDto) {
    const channel = await this.findChannel(id);
    await this.assertCanManageRepository(user, channel.repositoryId);
    const configuration = input.configuration ?? (input.url ? { url: input.url } : undefined);
    const url = configuration === undefined ? undefined : this.channelUrls.prepare(channel.type, configuration);
    if (url === null) throw new ForbiddenException('Browser push channels do not accept destination configuration.');
    if (input.enabled && channel.requiresReconfiguration && url === undefined) {
      throw new ForbiddenException('Configure a replacement Apprise URL before enabling this channel.');
    }
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
      },
      include: notificationChannelInclude,
    });
  }

  /** Delete a channel after resolving its repository-scoped management access. */
  async deleteChannel(user: AuthenticatedUser, id: string): Promise<void> {
    const channel = await this.findChannel(id);
    await this.assertCanManageRepository(user, channel.repositoryId);
    await this.prisma.notificationChannel.delete({ where: { id } });
  }

  /** Return rules that belong to repositories visible to the current user. */
  async listRules(user: AuthenticatedUser, repositoryId?: string) {
    const ability = await this.getAbility(user);
    const accessibleWhere = accessibleBy(ability, CaslAction.Read).ofType(
      CaslSubject.NotificationRule as never,
    ) as Prisma.NotificationRuleWhereInput;
    return this.prisma.notificationRule.findMany({
      include: notificationRuleInclude,
      orderBy: [{ workflowPattern: 'asc' }, { id: 'asc' }],
      where: { AND: [accessibleWhere, ...(repositoryId ? [{ repositoryId }] : [])] },
    });
  }

  /** Create a repository rule with one or more channels from the same repository. */
  async createRule(user: AuthenticatedUser, input: CreateNotificationRuleDto) {
    await this.assertCanManageRepository(user, input.repositoryId);
    this.workflowFilters.validatePattern(input.workflowPattern);
    const channelIds = await this.assertChannelsBelongToRepository(input.channelIds, input.repositoryId);
    return this.prisma.notificationRule.create({
      data: {
        repositoryId: input.repositoryId,
        workflowPattern: input.workflowPattern.trim(),
        outcome: input.outcome,
        enabled: input.enabled ?? true,
        channelLinks: { createMany: { data: channelIds.map((notificationChannelId) => ({ notificationChannelId })) } },
      },
      include: notificationRuleInclude,
    });
  }

  /** Update a repository rule and, when supplied, atomically replace its channels. */
  async updateRule(user: AuthenticatedUser, id: string, input: UpdateNotificationRuleDto) {
    const rule = await this.findRule(id);
    await this.assertCanManageRepository(user, rule.repositoryId);
    if (input.workflowPattern !== undefined) this.workflowFilters.validatePattern(input.workflowPattern);
    const channelIds =
      input.channelIds === undefined
        ? undefined
        : await this.assertChannelsBelongToRepository(input.channelIds, rule.repositoryId);
    return this.prisma.notificationRule.update({
      where: { id },
      data: {
        ...(input.workflowPattern === undefined ? {} : { workflowPattern: input.workflowPattern.trim() }),
        ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(channelIds === undefined
          ? {}
          : {
              channelLinks: {
                createMany: { data: channelIds.map((notificationChannelId) => ({ notificationChannelId })) },
                deleteMany: {},
              },
            }),
      },
      include: notificationRuleInclude,
    });
  }

  /** Delete a rule after resolving its repository-scoped management access. */
  async deleteRule(user: AuthenticatedUser, id: string): Promise<void> {
    const rule = await this.findRule(id);
    await this.assertCanManageRepository(user, rule.repositoryId);
    await this.prisma.notificationRule.delete({ where: { id } });
  }

  /** List delivery history limited to system administrators and repository managers. */
  async listDeliveryHistory(user: AuthenticatedUser, repositoryId?: string) {
    const managedRepositoryIds = await this.getManagedRepositoryIds(user);
    const repositoryIds =
      user.role === 'SYSTEM_ADMIN'
        ? repositoryId
          ? [repositoryId]
          : undefined
        : repositoryId
          ? managedRepositoryIds.filter((id) => id === repositoryId)
          : managedRepositoryIds;
    return this.prisma.notificationDelivery.findMany({
      include: notificationDeliveryHistoryInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: {
        OR: [
          { notificationRule: repositoryIds ? { repositoryId: { in: repositoryIds } } : {} },
          { testChannel: repositoryIds ? { repositoryId: { in: repositoryIds } } : {} },
        ],
      },
    });
  }

  /** Create and immediately execute one non-retrying test delivery. */
  async testChannel(user: AuthenticatedUser, id: string) {
    const channel = await this.findChannel(id);
    await this.assertCanManageRepository(user, channel.repositoryId);
    if (channel.type === NotificationChannelType.BROWSER_PUSH && channel.browserRecipientUserId !== user.id)
      throw new ForbiddenException('Only the browser-push recipient can test this channel.');
    const delivery = await this.prisma.notificationDelivery.create({
      data: {
        kind: NotificationDeliveryKind.TEST,
        requestedByUserId: user.id,
        testChannelId: channel.id,
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
   * Resolve enabled rules that match one persisted terminal run.
   *
   * Delivery creation intentionally remains separate so matching can be tested
   * independently and persisted idempotently by the delivery workflow.
   */
  async evaluateRulesForRun(run: {
    id: string;
    repositoryId: string;
    status: 'SUCCESS' | 'FAILED' | 'QUEUED' | 'RUNNING' | 'CANCELLED' | 'SKIPPED' | 'UNKNOWN';
    workflowName: string;
  }) {
    if (run.status !== 'SUCCESS' && run.status !== 'FAILED') return [];
    const rules = await this.prisma.notificationRule.findMany({
      include: notificationRuleInclude,
      where: { enabled: true, outcome: run.status, repositoryId: run.repositoryId },
    });
    const matchingRules = rules.filter((rule) =>
      picomatch.isMatch(run.workflowName, rule.workflowPattern, { bash: true }),
    );
    if (matchingRules.length > 0) {
      const created = await this.prisma.notificationDelivery.createMany({
        data: matchingRules.map((rule) => ({ notificationRuleId: rule.id, workflowRunId: run.id })),
        skipDuplicates: true,
      });
      if (created.count > 0) {
        const deliveries = await this.prisma.notificationDelivery.findMany({
          select: { id: true },
          where: { notificationRuleId: { in: matchingRules.map((rule) => rule.id) }, workflowRunId: run.id },
        });
        await this.deliveryService.deliverPending(deliveries.map((delivery) => delivery.id));
      }
    }
    return matchingRules;
  }

  private async getAbility(user: AuthenticatedUser) {
    const memberships = await this.prisma.repositoryMembership.findMany({
      where: { userId: user.id },
      select: { repositoryId: true, role: true },
    });
    return this.abilityFactory.createForUser(user, memberships);
  }

  private async assertCanManageRepository(user: AuthenticatedUser, repositoryId: string): Promise<void> {
    if (user.role === 'SYSTEM_ADMIN') return;
    if (user.role !== 'MANAGER') throw new ForbiddenException('Repository manager access is required.');

    const membership = await this.prisma.repositoryMembership.findUnique({
      where: { userId_repositoryId: { repositoryId, userId: user.id } },
      select: { role: true },
    });
    if (membership?.role !== 'MANAGER') throw new ForbiddenException('Repository manager access is required.');
  }

  private async getManagedRepositoryIds(user: AuthenticatedUser): Promise<string[]> {
    if (user.role === 'SYSTEM_ADMIN') return [];
    if (user.role !== 'MANAGER') return [];
    const memberships = await this.prisma.repositoryMembership.findMany({
      where: { role: 'MANAGER', userId: user.id },
      select: { repositoryId: true },
    });
    return memberships.map((membership) => membership.repositoryId);
  }

  private async findChannel(id: string) {
    const channel = await this.prisma.notificationChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Notification channel not found.');
    return channel;
  }

  private async findRule(id: string) {
    const rule = await this.prisma.notificationRule.findUnique({ where: { id }, include: notificationRuleInclude });
    if (!rule) throw new NotFoundException('Notification rule not found.');
    return rule;
  }

  private async assertChannelsBelongToRepository(channelIds: string[], repositoryId: string): Promise<string[]> {
    const uniqueChannelIds = [...new Set(channelIds)];
    if (uniqueChannelIds.length !== channelIds.length) {
      throw new ForbiddenException('Notification channels must not be repeated in a rule.');
    }
    const channels = await this.prisma.notificationChannel.findMany({
      select: { id: true },
      where: { id: { in: uniqueChannelIds }, repositoryId },
    });
    if (channels.length !== uniqueChannelIds.length) {
      throw new ForbiddenException('Notification rules can only use channels from the same repository.');
    }
    return uniqueChannelIds;
  }
}
