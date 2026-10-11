import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
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
import { CustomersService } from './application/customers.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { CustomerListQueryDto } from './dto/customer-list-query.dto.js';
import { ArchiveCustomerDto } from './dto/archive-customer.dto.js';

@Controller('organizations/:organizationId/customers')
@UseGuards(AccessAuthGuard, AuthorizationGuard)
export class CustomersController {
  constructor(customers, requestContext) {
    this.customers = customers;
    this.requestContext = requestContext;
  }

  @Post()
  async create(input, request, response) {
    return this.resourceResponse(
      response,
      await this.customers.create(request.tenant, input, this.auditMetadata()),
    );
  }

  @Get()
  async list(query, request) {
    return this.customers.list(request.tenant, query);
  }

  @Get(':customerId')
  async get(customerId, request, response) {
    return this.resourceResponse(response, await this.customers.get(request.tenant, customerId));
  }

  @Patch(':customerId')
  async update(customerId, ifMatch, input, request, response) {
    return this.resourceResponse(
      response,
      await this.customers.update(
        request.tenant,
        customerId,
        this.parseExpectedVersion(ifMatch),
        input,
        this.auditMetadata(),
      ),
    );
  }

  @Post(':customerId/archive')
  @HttpCode(HttpStatus.OK)
  async archive(customerId, _input, request, response) {
    return this.resourceResponse(
      response,
      await this.customers.archive(request.tenant, customerId, this.auditMetadata()),
    );
  }

  parseExpectedVersion(ifMatch) {
    const match =
      typeof ifMatch === 'string' ? /^(?:W\/)?"(\d+)"$|^(\d+)$/.exec(ifMatch.trim()) : null;
    const version = match ? Number(match[1] ?? match[2]) : Number.NaN;
    if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) {
      throw new ApplicationError(
        ERROR_CODES.INVALID_REQUEST,
        'If-Match must contain a positive customer version.',
      );
    }
    return version;
  }

  resourceResponse(response, customer) {
    response.setHeader('ETag', `"${customer.version}"`);
    return { data: customer };
  }

  auditMetadata() {
    const context = this.requestContext.get();
    return { requestId: context?.requestId, correlationId: context?.correlationId };
  }
}

Body()(CustomersController.prototype, 'create', 0);
Req()(CustomersController.prototype, 'create', 1);
Res({ passthrough: true })(CustomersController.prototype, 'create', 2);
Reflect.defineMetadata(
  'design:paramtypes',
  [CreateCustomerDto, Object, Object],
  CustomersController.prototype,
  'create',
);
Query()(CustomersController.prototype, 'list', 0);
Req()(CustomersController.prototype, 'list', 1);
Reflect.defineMetadata(
  'design:paramtypes',
  [CustomerListQueryDto, Object],
  CustomersController.prototype,
  'list',
);

for (const method of ['get', 'update', 'archive']) {
  Param('customerId', new ParseUUIDPipe({ version: '4' }))(
    CustomersController.prototype,
    method,
    0,
  );
}
Req()(CustomersController.prototype, 'get', 1);
Res({ passthrough: true })(CustomersController.prototype, 'get', 2);
Headers('if-match')(CustomersController.prototype, 'update', 1);
Body()(CustomersController.prototype, 'update', 2);
Req()(CustomersController.prototype, 'update', 3);
Res({ passthrough: true })(CustomersController.prototype, 'update', 4);
Reflect.defineMetadata(
  'design:paramtypes',
  [String, String, UpdateCustomerDto, Object, Object],
  CustomersController.prototype,
  'update',
);
Body()(CustomersController.prototype, 'archive', 1);
Req()(CustomersController.prototype, 'archive', 2);
Res({ passthrough: true })(CustomersController.prototype, 'archive', 3);
Reflect.defineMetadata(
  'design:paramtypes',
  [String, ArchiveCustomerDto, Object, Object],
  CustomersController.prototype,
  'archive',
);
Inject(CustomersService)(CustomersController, undefined, 0);
Inject(RequestContextStore)(CustomersController, undefined, 1);

for (const [method, permission] of [
  ['create', PERMISSIONS.CUSTOMER_CREATE],
  ['list', PERMISSIONS.CUSTOMER_READ],
  ['get', PERMISSIONS.CUSTOMER_READ],
  ['update', PERMISSIONS.CUSTOMER_UPDATE],
  ['archive', PERMISSIONS.CUSTOMER_ARCHIVE],
]) {
  RequirePermissions(permission)(
    CustomersController.prototype,
    method,
    Object.getOwnPropertyDescriptor(CustomersController.prototype, method),
  );
}
