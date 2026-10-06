import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AuthorizationGuard } from '../../common/authorization/authorization.guard.js';
import { PERMISSIONS } from '../../common/authorization/permissions.js';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator.js';
import { AccessAuthGuard } from '../auth/guards/access-auth.guard.js';
import { CashFlowService } from './application/cash-flow.service.js';
import { CashFlowQueryDto } from './dto/cash-flow-query.dto.js';

@Controller('organizations/:organizationId/cash-flow')
@UseGuards(AccessAuthGuard, AuthorizationGuard)
export class CashFlowController {
  constructor(cashFlow) {
    this.cashFlow = cashFlow;
  }
  @Get()
  get(query, request) {
    return this.cashFlow.get(request.tenant, query);
  }
}
Inject(CashFlowService)(CashFlowController, undefined, 0);
const proto = CashFlowController.prototype;
Query()(proto, 'get', 0);
Req()(proto, 'get', 1);
Reflect.defineMetadata('design:paramtypes', [CashFlowQueryDto, Object], proto, 'get');
RequirePermissions(PERMISSIONS.ANALYTICS_READ)(
  proto,
  'get',
  Object.getOwnPropertyDescriptor(proto, 'get'),
);
