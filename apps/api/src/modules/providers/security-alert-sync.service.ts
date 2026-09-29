import { Injectable } from '@nestjs/common';

import {
  NotificationEventType,
  Prisma,
  type SecurityAlertKind,
  type SecurityAlertState,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type {
  ProviderAccountContext,
  ProviderAdapter,
  ProviderRepositoryReference,
  ProviderSecurityAlert,
  ProviderSecurityAlertResult,
} from './provider-adapter.js';
import type { RepositorySyncProgressReporter } from './sync-progress.js';

const alertKinds = ['DEPENDENCY', 'CODE', 'SECRET'] as const satisfies SecurityAlertKind[];

/** Synchronizes normalized provider security alerts independently by kind. */
@Injectable()
export class SecurityAlertSyncService {
  /**
   * Initialize the security-alert synchronization service.
   *
   * @param prisma - Database client for normalized alerts and synchronization state.
   * @param notifications - Idempotent alert lifecycle notification service.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Persist provider alerts, independent availability, cursors, and silent first-sync baselines.
   *
   * @param context - Provider account credentials and instance configuration.
   * @param repository - Local and provider repository identity.
   * @param adapter - Read-only provider adapter.
   * @param reportProgress - Optional durable progress reporter.
   * @returns Alert kinds that were unavailable during the synchronization.
   */
  async synchronize(
    context: ProviderAccountContext,
    repository: ProviderRepositoryReference & { id: string },
    adapter: ProviderAdapter,
    reportProgress?: RepositorySyncProgressReporter,
  ): Promise<SecurityAlertKind[]> {
    await reportProgress?.({ current: 0, phase: 'SYNCING_ALERTS', total: alertKinds.length });
    const results = adapter.listSecurityAlerts
      ? await adapter.listSecurityAlerts(context, repository)
      : alertKinds.map<ProviderSecurityAlertResult>((kind) => ({
          alerts: [],
          availability: 'UNSUPPORTED',
          kind,
          reason: 'This provider does not expose a supported security-alert API.',
        }));
    const resultsByKind = new Map(results.map((result) => [result.kind, result]));
    const warnings: SecurityAlertKind[] = [];
    for (const [index, kind] of alertKinds.entries()) {
      const result = resultsByKind.get(kind) ?? {
        alerts: [],
        availability: 'UNAVAILABLE' as const,
        kind,
        reason: 'The provider did not return this alert type.',
      };
      if (result.availability === 'UNAVAILABLE') warnings.push(kind);
      await this.persistKind(repository.id, result);
      await reportProgress?.({ current: index + 1, phase: 'SYNCING_ALERTS', total: alertKinds.length });
    }
    return warnings;
  }

  /**
   * Persist one alert kind without allowing another kind's availability to block it.
   *
   * @param repositoryId - Local repository identifier.
   * @param result - Provider alerts and availability for one kind.
   * @returns A promise that resolves when the kind is persisted.
   */
  private async persistKind(repositoryId: string, result: ProviderSecurityAlertResult): Promise<void> {
    const previousSync = await this.prisma.securityAlertSyncState.findUnique({
      where: { repositoryId_kind: { kind: result.kind, repositoryId } },
    });
    if (result.availability !== 'AVAILABLE') {
      await this.prisma.securityAlertSyncState.upsert({
        where: { repositoryId_kind: { kind: result.kind, repositoryId } },
        create: {
          availability: result.availability,
          kind: result.kind,
          reason: result.reason,
          repositoryId,
        },
        update: { availability: result.availability, reason: result.reason },
      });
      return;
    }

    const baseline = !previousSync?.baselineEstablished;
    for (const alert of result.alerts) await this.persistAlert(repositoryId, alert, baseline);
    const synchronizedThrough = result.alerts.reduce<Date | null>(
      (latest, alert) => (!latest || alert.providerUpdatedAt > latest ? alert.providerUpdatedAt : latest),
      previousSync?.synchronizedThrough ?? null,
    );
    await this.prisma.securityAlertSyncState.upsert({
      where: { repositoryId_kind: { kind: result.kind, repositoryId } },
      create: {
        availability: 'AVAILABLE',
        baselineEstablished: true,
        kind: result.kind,
        lastSuccessfulSyncAt: new Date(),
        reason: null,
        repositoryId,
        synchronizedThrough,
      },
      update: {
        availability: 'AVAILABLE',
        baselineEstablished: true,
        lastSuccessfulSyncAt: new Date(),
        reason: null,
        synchronizedThrough,
      },
    });
  }

  /**
   * Upsert one safe alert and emit only post-baseline lifecycle transitions.
   *
   * @param repositoryId - Local repository identifier.
   * @param alert - Safe normalized provider alert.
   * @param baseline - Whether this kind is establishing its silent baseline.
   * @returns A promise that resolves after persistence and optional notification.
   */
  private async persistAlert(repositoryId: string, alert: ProviderSecurityAlert, baseline: boolean): Promise<void> {
    const key = { kind: alert.kind, providerAlertId: alert.providerAlertId, repositoryId };
    const { location, ...data } = alert;
    const previous = await this.prisma.securityAlert.findUnique({
      select: { state: true },
      where: { repositoryId_kind_providerAlertId: key },
    });
    const persisted = await this.prisma.securityAlert.upsert({
      where: { repositoryId_kind_providerAlertId: key },
      create: { ...data, location: location ?? Prisma.JsonNull, repositoryId },
      update: { ...data, location: location ?? Prisma.JsonNull },
    });
    if (baseline || previous?.state === alert.state) return;
    const eventType = this.notificationEvent(alert.kind, alert.state);
    await this.notifications.emitSecurityAlertEvent(eventType, persisted);
  }

  /**
   * Map opened versus terminal alert state to its kind-specific notification event.
   *
   * @param kind - Normalized alert kind.
   * @param state - Current normalized alert state.
   * @returns Matching opened or resolved notification event.
   */
  private notificationEvent(kind: SecurityAlertKind, state: SecurityAlertState): NotificationEventType {
    const opened = state === 'OPEN';
    if (kind === 'DEPENDENCY')
      return opened ? NotificationEventType.DEPENDENCY_ALERT_OPENED : NotificationEventType.DEPENDENCY_ALERT_RESOLVED;
    if (kind === 'CODE')
      return opened ? NotificationEventType.CODE_ALERT_OPENED : NotificationEventType.CODE_ALERT_RESOLVED;
    return opened ? NotificationEventType.SECRET_ALERT_OPENED : NotificationEventType.SECRET_ALERT_RESOLVED;
  }
}
