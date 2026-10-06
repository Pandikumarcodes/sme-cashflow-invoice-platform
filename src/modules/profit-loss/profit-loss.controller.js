import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AuthorizationGuard } from '../../common/authorization/authorization.guard.js';
import { PERMISSIONS } from '../../common/authorization/permissions.js';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator.js';
import { AccessAuthGuard } from '../auth/guards/access-auth.guard.js';
import { ProfitLossService } from './application/profit-loss.service.js';
import { ProfitLossQueryDto } from './dto/profit-loss-query.dto.js';

@Controller('organizations/:organizationId/profit-loss')
@UseGuards(AccessAuthGuard, AuthorizationGuard)
export class ProfitLossController {
  constructor(profitLoss) {
    this.profitLoss = profitLoss;
  }
  @Get()
  get(query, request) {
    return this.profitLoss.get(request.tenant, query);
  }
}
Inject(ProfitLossService)(ProfitLossController, undefined, 0);
const proto = ProfitLossController.prototype;
Query()(proto, 'get', 0);
Req()(proto, 'get', 1);
Reflect.defineMetadata('design:paramtypes', [ProfitLossQueryDto, Object], proto, 'get');
RequirePermissions(PERMISSIONS.ANALYTICS_READ)(
  proto,
  'get',
  Object.getOwnPropertyDescriptor(proto, 'get'),
);
