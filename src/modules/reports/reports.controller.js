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
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsObject } from 'class-validator';
import { ReportType } from '@prisma/client';
import { AccessAuthGuard } from '../auth/guards/access-auth.guard.js';
import { AuthorizationGuard } from '../../common/authorization/authorization.guard.js';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator.js';
import { PERMISSIONS } from '../../common/authorization/permissions.js';
import { ReportsService } from './application/reports.service.js';
import { RequestContextStore } from '../../common/request-context/request-context.store.js';

class ReportRequestDto {}
IsIn(Object.values(ReportType))(ReportRequestDto.prototype, 'reportType');
IsIn(['CSV'])(ReportRequestDto.prototype, 'format');
IsObject()(ReportRequestDto.prototype, 'parameters');
@Controller('organizations/:organizationId')
@UseGuards(AccessAuthGuard, AuthorizationGuard)
export class ReportsController {
  constructor(reports, requestContext) {
    this.reports = reports;
    this.requestContext = requestContext;
  }
  @Get('reports/invoices') invoices(query, request) {
    return this.reports.preview(request.tenant, 'INVOICE_REGISTER', query);
  }
  @Get('reports/payments') payments(query, request) {
    return this.reports.preview(request.tenant, 'PAYMENT_REGISTER', query);
  }
  @Get('reports/expenses') expenses(query, request) {
    return this.reports.preview(request.tenant, 'EXPENSE_REGISTER', query);
  }
  @Get('reports/receivables') receivables(query, request) {
    return this.reports.preview(request.tenant, 'RECEIVABLES', query);
  }
  @Post('reports/exports')
  @HttpCode(202)
  async create(input, request, response) {
    const result = await this.reports.request(
      request.tenant,
      input,
      request.headers['idempotency-key'],
      this.requestContext.get(),
    );
    if (result.replayed) response.setHeader('Idempotency-Replayed', 'true');
    return { data: result.data };
  }
  @Get('report-exports') list(query, request) {
    return this.reports.list(request.tenant, query);
  }
  @Get('report-exports/:exportId') detail(id, request) {
    return this.reports.detail(request.tenant, id);
  }
  @Get('report-exports/:exportId/download')
  async download(id, request, response) {
    const { bytes, filename } = await this.reports.download(
      request.tenant,
      id,
      this.requestContext.get(),
    );
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(bytes, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
      length: bytes.length,
    });
  }
}
Inject(ReportsService)(ReportsController, undefined, 0);
Inject(RequestContextStore)(ReportsController, undefined, 1);
const proto = ReportsController.prototype;
for (const method of ['invoices', 'payments', 'expenses', 'receivables', 'list']) {
  Query()(proto, method, 0);
  Req()(proto, method, 1);
  Reflect.defineMetadata('design:paramtypes', [Object, Object], proto, method);
}
Body()(proto, 'create', 0);
Req()(proto, 'create', 1);
Res({ passthrough: true })(proto, 'create', 2);
Reflect.defineMetadata('design:paramtypes', [ReportRequestDto, Object, Object], proto, 'create');
for (const method of ['detail', 'download']) {
  Param('exportId', new ParseUUIDPipe({ version: '4' }))(proto, method, 0);
  Req()(proto, method, 1);
}
Res({ passthrough: true })(proto, 'download', 2);
for (const method of [
  'invoices',
  'payments',
  'expenses',
  'receivables',
  'create',
  'list',
  'detail',
  'download',
])
  RequirePermissions(
    ['invoices', 'payments', 'expenses', 'receivables'].includes(method)
      ? PERMISSIONS.REPORT_READ
      : PERMISSIONS.REPORT_EXPORT,
  )(proto, method, Object.getOwnPropertyDescriptor(proto, method));
