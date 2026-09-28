import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsService } from './application/organizations.service.js';
import { OrganizationsController } from './organizations.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
