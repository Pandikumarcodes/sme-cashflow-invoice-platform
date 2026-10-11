import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApplicationError } from '../../common/errors/application-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';
import { AuthorizationGuard } from '../../common/authorization/authorization.guard.js';
import { PERMISSIONS } from '../../common/authorization/permissions.js';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator.js';
import { RequestContextStore } from '../../common/request-context/request-context.store.js';
import { AccessAuthGuard } from '../auth/guards/access-auth.guard.js';
import { InvoicesService } from './application/invoices.service.js';
import {
  CreateInvoiceDto,
  UpdateInvoiceDto,
  InvoiceListQueryDto,
  IssueInvoiceDto,
  InvoiceReasonDto,
} from './dto/invoice.dto.js';

@Controller('organizations/:organizationId/invoices')
@UseGuards(AccessAuthGuard, AuthorizationGuard)
export class InvoicesController {
  constructor(invoices, requestContext) {
    this.invoices = invoices;
    this.requestContext = requestContext;
  }
  @Post()
  async create(input, request, response) {
    return this.resource(
      response,
      await this.invoices.create(request.tenant, input, this.metadata()),
    );
  }
  @Get()
  list(query, request) {
    return this.invoices.list(request.tenant, query);
  }
  @Get(':invoiceId')
  async get(id, request, response) {
    return this.resource(response, await this.invoices.get(request.tenant, id));
  }
  @Patch(':invoiceId')
  async update(id, ifMatch, input, request, response) {
    return this.resource(
      response,
      await this.invoices.update(request.tenant, id, this.version(ifMatch), input, this.metadata()),
    );
  }
  @Delete(':invoiceId')
  @HttpCode(204)
  async deleteDraft(id, ifMatch, _input, request) {
    await this.invoices.deleteDraft(request.tenant, id, this.version(ifMatch), this.metadata());
  }
  @Post(':invoiceId/issue')
  @HttpCode(200)
  async issue(id, ifMatch, _input, request, response) {
    return this.resource(
      response,
      await this.invoices.issue(request.tenant, id, this.version(ifMatch), this.metadata()),
    );
  }
  @Post(':invoiceId/cancel')
  @HttpCode(200)
  async cancel(id, input, request, response) {
    return this.resource(
      response,
      await this.invoices.endLifecycle(
        request.tenant,
        id,
        'CANCELLED',
        input.reason,
        this.metadata(),
      ),
    );
  }
  @Post(':invoiceId/void')
  @HttpCode(200)
  async voidInvoice(id, input, request, response) {
    return this.resource(
      response,
      await this.invoices.endLifecycle(request.tenant, id, 'VOID', input.reason, this.metadata()),
    );
  }
  version(ifMatch) {
    const match =
      typeof ifMatch === 'string' ? /^(?:W\/)?"(\d+)"$|^(\d+)$/.exec(ifMatch.trim()) : null;
    const version = match ? Number(match[1] ?? match[2]) : Number.NaN;
    if (!Number.isSafeInteger(version) || version < 1 || version > 2147483647)
      throw new ApplicationError(
        ERROR_CODES.INVALID_REQUEST,
        'If-Match must contain a positive invoice version.',
      );
    return version;
  }
  resource(response, invoice) {
    response.setHeader('ETag', `"${invoice.version}"`);
    return { data: invoice };
  }
  metadata() {
    const ctx = this.requestContext.get();
    return { requestId: ctx?.requestId, correlationId: ctx?.correlationId };
  }
}
Inject(InvoicesService)(InvoicesController, undefined, 0);
Inject(RequestContextStore)(InvoicesController, undefined, 1);
const proto = InvoicesController.prototype;
for (const [method, permission, types, parameters] of [
  [
    'create',
    PERMISSIONS.INVOICE_CREATE,
    [CreateInvoiceDto, Object, Object],
    [Body(), Req(), Res({ passthrough: true })],
  ],
  ['list', PERMISSIONS.INVOICE_READ, [InvoiceListQueryDto, Object], [Query(), Req()]],
  [
    'get',
    PERMISSIONS.INVOICE_READ,
    [String, Object, Object],
    [Param('invoiceId', new ParseUUIDPipe({ version: '4' })), Req(), Res({ passthrough: true })],
  ],
  [
    'update',
    PERMISSIONS.INVOICE_UPDATE_DRAFT,
    [String, String, UpdateInvoiceDto, Object, Object],
    [
      Param('invoiceId', new ParseUUIDPipe({ version: '4' })),
      Headers('if-match'),
      Body(),
      Req(),
      Res({ passthrough: true }),
    ],
  ],
  [
    'deleteDraft',
    PERMISSIONS.INVOICE_DELETE_DRAFT,
    [String, String, IssueInvoiceDto, Object],
    [Param('invoiceId', new ParseUUIDPipe({ version: '4' })), Headers('if-match'), Body(), Req()],
  ],
  [
    'issue',
    PERMISSIONS.INVOICE_ISSUE,
    [String, String, IssueInvoiceDto, Object, Object],
    [
      Param('invoiceId', new ParseUUIDPipe({ version: '4' })),
      Headers('if-match'),
      Body(),
      Req(),
      Res({ passthrough: true }),
    ],
  ],
  [
    'cancel',
    PERMISSIONS.INVOICE_CANCEL,
    [String, InvoiceReasonDto, Object, Object],
    [
      Param('invoiceId', new ParseUUIDPipe({ version: '4' })),
      Body(),
      Req(),
      Res({ passthrough: true }),
    ],
  ],
  [
    'voidInvoice',
    PERMISSIONS.INVOICE_VOID,
    [String, InvoiceReasonDto, Object, Object],
    [
      Param('invoiceId', new ParseUUIDPipe({ version: '4' })),
      Body(),
      Req(),
      Res({ passthrough: true }),
    ],
  ],
]) {
  Reflect.defineMetadata('design:paramtypes', types, proto, method);
  parameters.forEach((parameter, index) => parameter(proto, method, index));
  RequirePermissions(permission)(proto, method, Object.getOwnPropertyDescriptor(proto, method));
}
