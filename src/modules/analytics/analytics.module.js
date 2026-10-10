import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FinancialModule } from '../financial/financial.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './application/analytics.service.js';

@Module({
  imports: [AuthModule, FinancialModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
