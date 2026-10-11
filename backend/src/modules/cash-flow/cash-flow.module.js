import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FinancialModule } from '../financial/financial.module.js';
import { CashFlowController } from './cash-flow.controller.js';
import { CashFlowService } from './application/cash-flow.service.js';

@Module({
  imports: [AuthModule, FinancialModule],
  controllers: [CashFlowController],
  providers: [CashFlowService],
})
export class CashFlowModule {}
