import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../../config/configuration.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthorizationModule } from '../../common/authorization/authorization.module.js';
import { QueueModule } from '../../infrastructure/queues/queue.module.js';
import { PendingEventDispatcher } from '../../infrastructure/queues/pending-event-dispatcher.js';
import { ReportsModule } from './reports.module.js';
import { ReportWorkers } from './processors/report-workers.js';
@Module({
  imports: [ConfigurationModule, DatabaseModule, AuthorizationModule, QueueModule, ReportsModule],
  providers: [PendingEventDispatcher, ReportWorkers],
})
export class ReportWorkerModule {}
