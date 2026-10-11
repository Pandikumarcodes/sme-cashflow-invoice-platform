import { Module } from '@nestjs/common';
import { NotificationWorkerModule } from './modules/notifications/notification-worker.module.js';
import { ReportWorkerModule } from './modules/reports/report-worker.module.js';
import { RequestContextModule } from './common/request-context/request-context.module.js';
@Module({ imports: [RequestContextModule, NotificationWorkerModule, ReportWorkerModule] })
export class WorkerModule {}
