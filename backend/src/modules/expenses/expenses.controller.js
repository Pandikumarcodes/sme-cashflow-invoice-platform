import {
  Body,
  Controller,
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
import { ExpensesService } from './application/expenses.service.js';
import {
  CreateExpenseDto,
  ExpenseListQueryDto,
  UpdateExpenseDto,
  VoidExpenseDto,
} from './dto/expense.dto.js';

@Controller('organizations/:organizationId/expenses')
@UseGuards(AccessAuthGuard, AuthorizationGuard)
export class ExpensesController {
  constructor(expenses, requestContext) {
    this.expenses = expenses;
    this.requestContext = requestContext;
  }
  @Post()
  async create(input, request, response) {
    return this.resource(
      response,
      await this.expenses.create(request.tenant, input, this.metadata()),
    );
  }
  @Get()
  list(query, request) {
    return this.expenses.list(request.tenant, query);
  }
  @Get(':expenseId')
  async get(id, request, response) {
    return this.resource(response, await this.expenses.get(request.tenant, id));
  }
  @Patch(':expenseId')
  async update(id, ifMatch, input, request, response) {
    return this.resource(
      response,
      await this.expenses.update(request.tenant, id, this.version(ifMatch), input, this.metadata()),
    );
  }
  @Post(':expenseId/void')
  @HttpCode(200)
  async void(id, ifMatch, input, request, response) {
    return this.resource(
      response,
      await this.expenses.void(request.tenant, id, this.version(ifMatch), input, this.metadata()),
    );
  }
  version(ifMatch) {
    const match =
      typeof ifMatch === 'string' ? /^(?:W\/)?"(\d+)"$|^(\d+)$/.exec(ifMatch.trim()) : null;
    const value = match ? Number(match[1] ?? match[2]) : Number.NaN;
    if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647)
      throw new ApplicationError(
        ERROR_CODES.INVALID_REQUEST,
        'If-Match must contain a positive expense version.',
      );
    return value;
  }
  resource(response, row) {
    response.setHeader('ETag', `"${row.version}"`);
    return { data: row };
  }
  metadata() {
    const context = this.requestContext.get();
    return { requestId: context?.requestId, correlationId: context?.correlationId };
  }
}
Inject(ExpensesService)(ExpensesController, undefined, 0);
Inject(RequestContextStore)(ExpensesController, undefined, 1);
const proto = ExpensesController.prototype;
Body()(proto, 'create', 0);
Req()(proto, 'create', 1);
Res({ passthrough: true })(proto, 'create', 2);
Reflect.defineMetadata('design:paramtypes', [CreateExpenseDto, Object, Object], proto, 'create');
Query()(proto, 'list', 0);
Req()(proto, 'list', 1);
Reflect.defineMetadata('design:paramtypes', [ExpenseListQueryDto, Object], proto, 'list');
Param('expenseId', new ParseUUIDPipe({ version: '4' }))(proto, 'get', 0);
Req()(proto, 'get', 1);
Res({ passthrough: true })(proto, 'get', 2);
for (const [method, dto] of [
  ['update', UpdateExpenseDto],
  ['void', VoidExpenseDto],
]) {
  Param('expenseId', new ParseUUIDPipe({ version: '4' }))(proto, method, 0);
  Headers('if-match')(proto, method, 1);
  Body()(proto, method, 2);
  Req()(proto, method, 3);
  Res({ passthrough: true })(proto, method, 4);
  Reflect.defineMetadata('design:paramtypes', [String, String, dto, Object, Object], proto, method);
}
for (const [method, permission] of [
  ['create', PERMISSIONS.EXPENSE_CREATE],
  ['list', PERMISSIONS.EXPENSE_READ],
  ['get', PERMISSIONS.EXPENSE_READ],
  ['update', PERMISSIONS.EXPENSE_UPDATE],
  ['void', PERMISSIONS.EXPENSE_VOID],
])
  RequirePermissions(permission)(proto, method, Object.getOwnPropertyDescriptor(proto, method));
