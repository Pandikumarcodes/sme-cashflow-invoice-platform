import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthorizationGuard } from '../../common/authorization/authorization.guard.js';
import { PERMISSIONS } from '../../common/authorization/permissions.js';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator.js';
import { AccessAuthGuard } from '../auth/guards/access-auth.guard.js';
import { NotificationsService } from './application/notifications.service.js';
import { NotificationListQueryDto, EmptyNotificationCommandDto } from './dto/notification.dto.js';

@Controller('organizations/:organizationId/notifications')
@UseGuards(AccessAuthGuard, AuthorizationGuard)
export class NotificationsController {
  constructor(notifications) {
    this.notifications = notifications;
  }
  @Get()
  list(query, request) {
    return this.notifications.list(request.tenant, query);
  }
  @Post(':notificationId/read')
  @HttpCode(200)
  read(id, _input, request) {
    return this.notifications.markRead(request.tenant, id);
  }
  @Post(':notificationId/archive')
  @HttpCode(200)
  archive(id, _input, request) {
    return this.notifications.archive(request.tenant, id);
  }
}
Inject(NotificationsService)(NotificationsController, undefined, 0);
const proto = NotificationsController.prototype;
Query()(proto, 'list', 0);
Req()(proto, 'list', 1);
Reflect.defineMetadata('design:paramtypes', [NotificationListQueryDto, Object], proto, 'list');
for (const method of ['list', 'read', 'archive']) {
  if (method !== 'list') {
    Param('notificationId', new ParseUUIDPipe({ version: '4' }))(proto, method, 0);
    Body()(proto, method, 1);
    Req()(proto, method, 2);
    Reflect.defineMetadata(
      'design:paramtypes',
      [String, EmptyNotificationCommandDto, Object],
      proto,
      method,
    );
  }
  RequirePermissions(
    method === 'list' ? PERMISSIONS.NOTIFICATION_READ : PERMISSIONS.NOTIFICATION_UPDATE_SELF,
  )(proto, method, Object.getOwnPropertyDescriptor(proto, method));
}
