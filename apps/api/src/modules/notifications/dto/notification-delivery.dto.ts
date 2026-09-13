import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type {
  NotificationChannelType,
  NotificationDelivery,
  NotificationDeliveryAttempt,
  NotificationDeliveryKind,
  NotificationEventType,
} from '../../../generated/prisma/client.js';

type DeliveryAttemptModel = NotificationDeliveryAttempt & {
  browserPushSubscription?: { id: string } | null;
  notificationChannel?: { name: string; type: NotificationChannelType };
};

export type DeliveryHistoryModel = NotificationDelivery & {
  attempts: DeliveryAttemptModel[];
  issue?: { id: string; number: string; title: string; url: string } | null;
  notificationChannel: { id: string; name: string; type: NotificationChannelType };
  pullRequest?: { id: string; number: string; title: string; url: string } | null;
  repository?: { id: string; name: string; owner: string } | null;
  requestedBy?: { username: string } | null;
  workflowRun?: { id: string; url: string; workflowName: string } | null;
};

/** Safe delivery-attempt metadata visible to system administrators. */
export class NotificationDeliveryAttemptDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  notificationChannelId!: string;
  @ApiProperty()
  notificationChannelName!: string;
  @ApiProperty()
  notificationChannelType!: NotificationChannelType;
  @ApiPropertyOptional({ format: 'uuid' })
  browserPushSubscriptionId!: string | null;
  @ApiPropertyOptional()
  deviceLabel!: string | null;
  @ApiProperty()
  attempt!: number;
  @ApiPropertyOptional()
  deliveredAt!: Date | null;
  @ApiPropertyOptional()
  error!: string | null;
  @ApiProperty()
  createdAt!: Date;

  /** Convert an attempt without exposing any channel or subscription secret. */
  static fromModel(model: DeliveryAttemptModel): NotificationDeliveryAttemptDto {
    return {
      id: model.id,
      notificationChannelId: model.notificationChannelId,
      notificationChannelName: model.notificationChannel?.name ?? 'Deleted channel',
      notificationChannelType: model.notificationChannel?.type ?? 'CUSTOM_APPRISE',
      browserPushSubscriptionId: model.browserPushSubscriptionId,
      deviceLabel: model.browserPushSubscription ? 'Browser device' : null,
      attempt: model.attempt,
      deliveredAt: model.deliveredAt,
      error: model.error,
      createdAt: model.createdAt,
    };
  }
}

/** Safe global event or test delivery history representation. */
export class NotificationDeliveryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  kind!: NotificationDeliveryKind;
  @ApiPropertyOptional()
  eventType!: NotificationEventType | null;
  @ApiProperty({ format: 'uuid' })
  notificationChannelId!: string;
  @ApiProperty()
  notificationChannelName!: string;
  @ApiProperty()
  notificationChannelType!: NotificationChannelType;
  @ApiPropertyOptional({ format: 'uuid' })
  repositoryId!: string | null;
  @ApiPropertyOptional()
  repositoryOwner!: string | null;
  @ApiPropertyOptional()
  repositoryName!: string | null;
  @ApiPropertyOptional()
  subjectKind!: 'WORKFLOW_RUN' | 'PULL_REQUEST' | 'ISSUE' | null;
  @ApiPropertyOptional()
  subjectTitle!: string | null;
  @ApiPropertyOptional()
  subjectUrl!: string | null;
  @ApiPropertyOptional()
  requestedByUsername!: string | null;
  @ApiProperty()
  status!: NotificationDelivery['status'];
  @ApiPropertyOptional()
  finalError!: string | null;
  @ApiPropertyOptional()
  nextAttemptAt!: Date | null;
  @ApiProperty()
  createdAt!: Date;
  @ApiProperty()
  updatedAt!: Date;
  @ApiProperty({ type: [NotificationDeliveryAttemptDto] })
  attempts!: NotificationDeliveryAttemptDto[];

  /** Convert a delivery and its relations without credentials or endpoint details. */
  static fromModel(model: DeliveryHistoryModel): NotificationDeliveryDto {
    const subjectKind = model.workflowRun
      ? 'WORKFLOW_RUN'
      : model.pullRequest
        ? 'PULL_REQUEST'
        : model.issue
          ? 'ISSUE'
          : null;
    return {
      id: model.id,
      kind: model.kind,
      eventType: model.eventType,
      notificationChannelId: model.notificationChannelId,
      notificationChannelName: model.notificationChannel.name,
      notificationChannelType: model.notificationChannel.type,
      repositoryId: model.repository?.id ?? null,
      repositoryOwner: model.repository?.owner ?? null,
      repositoryName: model.repository?.name ?? null,
      subjectKind,
      subjectTitle:
        model.workflowRun?.workflowName ??
        (model.pullRequest ? `#${model.pullRequest.number} ${model.pullRequest.title}` : undefined) ??
        (model.issue ? `#${model.issue.number} ${model.issue.title}` : null),
      subjectUrl: model.workflowRun?.url ?? model.pullRequest?.url ?? model.issue?.url ?? null,
      requestedByUsername: model.requestedBy?.username ?? null,
      status: model.status,
      finalError: model.finalError,
      nextAttemptAt: model.nextAttemptAt,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
      attempts: model.attempts.map(NotificationDeliveryAttemptDto.fromModel),
    };
  }
}
