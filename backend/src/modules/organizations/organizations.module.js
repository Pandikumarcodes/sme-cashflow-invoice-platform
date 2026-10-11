import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsService } from './application/organizations.service.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationInvoiceSettings } from './application/organization-invoice-settings.js';

@Module({
  imports: [AuthModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationInvoiceSettings],
  exports: [OrganizationsService, OrganizationInvoiceSettings],
})
export class OrganizationsModule {}
