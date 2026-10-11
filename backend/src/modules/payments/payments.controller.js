import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthorizationGuard } from '../../common/authorization/authorization.guard.js';
import { PERMISSIONS } from '../../common/authorization/permissions.js';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator.js';
import { RequestContextStore } from '../../common/request-context/request-context.store.js';
import { AccessAuthGuard } from '../auth/guards/access-auth.guard.js';
import { PaymentsService } from './application/payments.service.js';
import { RecordPaymentDto, ReversePaymentDto, PaymentListQueryDto } from './dto/payment.dto.js';
import { validateIdempotencyKey } from '../../common/idempotency/idempotency.service.js';

@Controller('organizations/:organizationId')
@UseGuards(AccessAuthGuard, AuthorizationGuard)
export class PaymentsController {
  constructor(payments, requestContext) {
    this.payments = payments;
    this.requestContext = requestContext;
  }
  @Post('invoices/:invoiceId/payments')
  async record(invoiceId, key, input, request, response) {
    return this.command(
      response,
      await this.payments.record(
        request.tenant,
        invoiceId,
        input,
        validateIdempotencyKey(key),
        this.metadata(),
      ),
    );
  }
  @Get('payments')
  list(query, request) {
    return this.payments.list(request.tenant, query);
  }
  @Get('payments/:paymentId')
  async get(paymentId, request) {
    return { data: await this.payments.get(request.tenant, paymentId) };
  }
  @Post('payments/:paymentId/reverse')
  @HttpCode(200)
  async reverse(paymentId, key, input, request, response) {
    return this.command(
      response,
      await this.payments.reverse(
        request.tenant,
        paymentId,
        input,
        validateIdempotencyKey(key),
        this.metadata(),
      ),
    );
  }
  command(response, result) {
    response.status(result.httpStatus);
    if (result.replayed) response.setHeader('Idempotency-Replayed', 'true');
    return { data: result.data };
  }
  metadata() {
    const ctx = this.requestContext.get();
    return { requestId: ctx?.requestId, correlationId: ctx?.correlationId };
  }
}
Inject(PaymentsService)(PaymentsController, undefined, 0);
Inject(RequestContextStore)(PaymentsController, undefined, 1);
const proto = PaymentsController.prototype;
for (const [method, permission, types, parameters] of [
  [
    'record',
    PERMISSIONS.PAYMENT_CREATE,
    [String, String, RecordPaymentDto, Object, Object],
    [
      Param('invoiceId', new ParseUUIDPipe({ version: '4' })),
      Headers('idempotency-key'),
      Body(),
      Req(),
      Res({ passthrough: true }),
    ],
  ],
  ['list', PERMISSIONS.PAYMENT_READ, [PaymentListQueryDto, Object], [Query(), Req()]],
  [
    'get',
    PERMISSIONS.PAYMENT_READ,
    [String, Object],
    [Param('paymentId', new ParseUUIDPipe({ version: '4' })), Req()],
  ],
  [
    'reverse',
    PERMISSIONS.PAYMENT_REVERSE,
    [String, String, ReversePaymentDto, Object, Object],
    [
      Param('paymentId', new ParseUUIDPipe({ version: '4' })),
      Headers('idempotency-key'),
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
