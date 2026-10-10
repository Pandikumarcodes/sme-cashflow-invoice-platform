import { Module } from '@nestjs/common';
import { CashFlowReader } from './infrastructure/cash-flow-reader.js';
import { ProfitLossReader } from './infrastructure/profit-loss-reader.js';
import { AnalyticsReader } from './infrastructure/analytics-reader.js';
import { ReportReader } from './infrastructure/report-reader.js';

@Module({
  providers: [CashFlowReader, ProfitLossReader, AnalyticsReader, ReportReader],
  exports: [CashFlowReader, ProfitLossReader, AnalyticsReader, ReportReader],
})
export class FinancialModule {}
