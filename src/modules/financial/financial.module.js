import { Module } from '@nestjs/common';
import { CashFlowReader } from './infrastructure/cash-flow-reader.js';
import { ProfitLossReader } from './infrastructure/profit-loss-reader.js';

@Module({
  providers: [CashFlowReader, ProfitLossReader],
  exports: [CashFlowReader, ProfitLossReader],
})
export class FinancialModule {}
