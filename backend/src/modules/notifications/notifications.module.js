import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './application/notifications.service.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { RemindersService } from './application/reminders.service.js';
import { EmailProvider } from './infrastructure/email-provider.js';
import { ReportReadyNotifier } from './application/report-ready-notifier.js';
@Module({
  imports: [AuthModule, InvoicesModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, RemindersService, EmailProvider, ReportReadyNotifier],
  exports: [RemindersService, ReportReadyNotifier],
})
export class NotificationsModule {}
