import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AuthorizationGuard } from '../../common/authorization/authorization.guard.js';
import { PERMISSIONS } from '../../common/authorization/permissions.js';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator.js';
import { AccessAuthGuard } from '../auth/guards/access-auth.guard.js';
import { AuditLogsService } from './application/audit-logs.service.js';
import { AuditListQueryDto } from './dto/audit-list-query.dto.js';

@Controller('organizations/:organizationId/audit-logs')
@UseGuards(AccessAuthGuard, AuthorizationGuard)
export class AuditLogsController {
  constructor(auditLogs) {
    this.auditLogs = auditLogs;
  }
  @Get()
  list(query, request) {
    return this.auditLogs.list(request.tenant, query);
  }
}
Inject(AuditLogsService)(AuditLogsController, undefined, 0);
const proto = AuditLogsController.prototype;
Query()(proto, 'list', 0);
Req()(proto, 'list', 1);
Reflect.defineMetadata('design:paramtypes', [AuditListQueryDto, Object], proto, 'list');
RequirePermissions(PERMISSIONS.AUDIT_READ)(
  proto,
  'list',
  Object.getOwnPropertyDescriptor(proto, 'list'),
);
