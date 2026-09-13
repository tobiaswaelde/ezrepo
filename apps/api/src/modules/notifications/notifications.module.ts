import { Module } from '@nestjs/common';

import { CaslModule } from '../../casl/casl.module.js';
import { JobsModule } from '../../jobs/jobs.module.js';
import { SecurityModule } from '../../security/security.module.js';
import { AppriseNotificationAdapter } from './apprise-notification.adapter.js';
import { BrowserPushController } from './browser-push.controller.js';
import { BrowserPushService } from './browser-push.service.js';
import { NotificationChannelUrlService } from './notification-channel-url.service.js';
import { NotificationDeliveriesController } from './notification-deliveries.controller.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { NotificationChannelsQueryService, NotificationDeliveriesQueryService } from './notification-query.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/** Registers global notification configuration and delivery. */
@Module({
  imports: [CaslModule, JobsModule, SecurityModule],
  controllers: [NotificationsController, NotificationDeliveriesController, BrowserPushController],
  providers: [
    NotificationsService,
    NotificationDeliveryService,
    NotificationChannelUrlService,
    AppriseNotificationAdapter,
    BrowserPushService,
    NotificationChannelsQueryService,
    NotificationDeliveriesQueryService,
  ],
  exports: [NotificationsService, NotificationDeliveryService],
})
export class NotificationsModule {}
