import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FinancialModule } from '../financial/financial.module.js';
import { ProfitLossController } from './profit-loss.controller.js';
import { ProfitLossService } from './application/profit-loss.service.js';

@Module({
  imports: [AuthModule, FinancialModule],
  controllers: [ProfitLossController],
  providers: [ProfitLossService],
})
export class ProfitLossModule {}
