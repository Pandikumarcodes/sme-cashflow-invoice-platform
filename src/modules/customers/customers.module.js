import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './application/customers.service.js';
import { CustomerInvoiceReader } from './application/customer-invoice-reader.js';

@Module({
  imports: [AuthModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerInvoiceReader],
  exports: [CustomerInvoiceReader],
})
export class CustomersModule {}
