import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../../config/configuration.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { QueueModule } from '../../infrastructure/queues/queue.module.js';
import { PendingEventDispatcher } from '../../infrastructure/queues/pending-event-dispatcher.js';
import { NotificationsModule } from './notifications.module.js';
import { NotificationWorkers } from './processors/notification-workers.js';
@Module({
  imports: [
    ConfigurationModule,
    DatabaseModule,
    AuthorizationModule,
    QueueModule,
    NotificationsModule,
  ],
  providers: [PendingEventDispatcher, NotificationWorkers],
})
export class NotificationWorkerModule {}
