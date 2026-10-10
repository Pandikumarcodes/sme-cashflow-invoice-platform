import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AuthorizationGuard } from '../../common/authorization/authorization.guard.js';
import { PERMISSIONS } from '../../common/authorization/permissions.js';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator.js';
import { AccessAuthGuard } from '../auth/guards/access-auth.guard.js';
import { AnalyticsService } from './application/analytics.service.js';
import { AnalyticsQueryDto, AgingQueryDto } from './dto/analytics-query.dto.js';

@Controller('organizations/:organizationId/analytics')
@UseGuards(AccessAuthGuard, AuthorizationGuard)
export class AnalyticsController {
  constructor(analytics) {
    this.analytics = analytics;
  }
  @Get('receivables-aging')
  aging(query, request) {
    return this.analytics.aging(request.tenant, query);
  }
  @Get('summary')
  summary(query, request) {
    return this.analytics.summary(request.tenant, query);
  }
}
Inject(AnalyticsService)(AnalyticsController, undefined, 0);
const proto = AnalyticsController.prototype;
for (const [method, dto] of [
  ['summary', AnalyticsQueryDto],
  ['aging', AgingQueryDto],
]) {
  Query()(proto, method, 0);
  Req()(proto, method, 1);
  Reflect.defineMetadata('design:paramtypes', [dto, Object], proto, method);
  RequirePermissions(PERMISSIONS.ANALYTICS_READ)(
    proto,
    method,
    Object.getOwnPropertyDescriptor(proto, method),
  );
}
