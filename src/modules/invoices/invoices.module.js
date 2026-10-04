import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './application/invoices.service.js';
import { InvoicePersistence } from './infrastructure/invoice-persistence.js';
import { InvoiceSettlement } from './application/invoice-settlement.js';

@Module({
  imports: [AuthModule, CustomersModule, OrganizationsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicePersistence, InvoiceSettlement],
  exports: [InvoiceSettlement],
})
export class InvoicesModule {}
