import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MembershipsService } from './application/memberships.service.js';
import { InvitationAcceptanceController, MembershipsController } from './memberships.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [MembershipsController, InvitationAcceptanceController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
