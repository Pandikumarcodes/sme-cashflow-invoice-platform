import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FinancialModule } from '../financial/financial.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './application/reports.service.js';
import { ReportGenerationService } from './application/report-generation.service.js';
import { ReportStorage } from './infrastructure/report-storage.js';
import { ReportPersistence } from './infrastructure/report-persistence.js';
@Module({
  imports: [AuthModule, FinancialModule, NotificationsModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportGenerationService,
    ReportStorage,
    ReportPersistence,
    IdempotencyService,
  ],
  exports: [ReportGenerationService],
})
export class ReportsModule {}
