import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type {
  NotificationChannelType,
  NotificationDelivery,
  NotificationDeliveryAttempt,
  NotificationDeliveryKind,
  NotificationRuleOutcome,
} from '../../../generated/prisma/client.js';

type DeliveryAttemptModel = NotificationDeliveryAttempt & {
  browserPushSubscription?: { id: string } | null;
  notificationChannel?: { name: string; type: NotificationChannelType };
};

type DeliveryHistoryModel = NotificationDelivery & {
  attempts: DeliveryAttemptModel[];
  notificationRule?: {
    outcome: NotificationRuleOutcome;
    repository: { id: string; name: string; owner: string };
    workflowPattern: string;
  } | null;
  requestedBy?: { username: string } | null;
  testChannel?: { name: string; repository: { id: string; name: string; owner: string } } | null;
  workflowRun?: { id: string; url: string; workflowName: string } | null;
};

/** Safe delivery-attempt metadata visible to authorized repository managers. */
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

/** Safe workflow or test delivery history representation. */
export class NotificationDeliveryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  kind!: NotificationDeliveryKind;
  @ApiPropertyOptional({ format: 'uuid' })
  notificationRuleId!: string | null;
  @ApiPropertyOptional({ format: 'uuid' })
  workflowRunId!: string | null;
  @ApiProperty({ format: 'uuid' })
  repositoryId!: string;
  @ApiProperty()
  repositoryOwner!: string;
  @ApiProperty()
  repositoryName!: string;
  @ApiPropertyOptional()
  workflowName!: string | null;
  @ApiPropertyOptional()
  workflowUrl!: string | null;
  @ApiPropertyOptional()
  workflowPattern!: string | null;
  @ApiPropertyOptional()
  outcome!: NotificationRuleOutcome | null;
  @ApiPropertyOptional()
  testChannelName!: string | null;
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
    const repository = model.notificationRule?.repository ?? model.testChannel?.repository;
    if (!repository) throw new Error('Notification delivery repository is missing.');
    return {
      id: model.id,
      kind: model.kind,
      notificationRuleId: model.notificationRuleId,
      workflowRunId: model.workflowRunId,
      repositoryId: repository.id,
      repositoryOwner: repository.owner,
      repositoryName: repository.name,
      workflowName: model.workflowRun?.workflowName ?? null,
      workflowUrl: model.workflowRun?.url ?? null,
      workflowPattern: model.notificationRule?.workflowPattern ?? null,
      outcome: model.notificationRule?.outcome ?? null,
      testChannelName: model.testChannel?.name ?? null,
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
