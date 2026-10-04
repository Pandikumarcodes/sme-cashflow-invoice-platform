import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './application/payments.service.js';
import { PaymentPersistence } from './infrastructure/payment-persistence.js';

@Module({
  imports: [AuthModule, InvoicesModule, IdempotencyModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentPersistence],
})
export class PaymentsModule {}
