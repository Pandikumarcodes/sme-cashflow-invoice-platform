import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthorizationGuard } from '../../common/authorization/authorization.guard.js';
import { PERMISSIONS } from '../../common/authorization/permissions.js';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator.js';
import { RequestContextStore } from '../../common/request-context/request-context.store.js';
import { AccessAuthGuard } from '../auth/guards/access-auth.guard.js';
import { ExpenseCategoriesService } from './application/expense-categories.service.js';
import {
  ArchiveCategoryDto,
  CategoryListQueryDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/expense.dto.js';

@Controller('organizations/:organizationId/expense-categories')
@UseGuards(AccessAuthGuard, AuthorizationGuard)
export class ExpenseCategoriesController {
  constructor(categories, requestContext) {
    this.categories = categories;
    this.requestContext = requestContext;
  }
  @Get()
  list(query, request) {
    return this.categories.list(request.tenant, query);
  }
  @Post()
  async create(input, request) {
    return { data: await this.categories.create(request.tenant, input, this.metadata()) };
  }
  @Patch(':categoryId')
  async update(id, input, request) {
    return { data: await this.categories.update(request.tenant, id, input, this.metadata()) };
  }
  @Post(':categoryId/archive')
  @HttpCode(200)
  async archive(id, _input, request) {
    return { data: await this.categories.archive(request.tenant, id, this.metadata()) };
  }
  metadata() {
    const context = this.requestContext.get();
    return { requestId: context?.requestId, correlationId: context?.correlationId };
  }
}
Inject(ExpenseCategoriesService)(ExpenseCategoriesController, undefined, 0);
Inject(RequestContextStore)(ExpenseCategoriesController, undefined, 1);
const proto = ExpenseCategoriesController.prototype;
Query()(proto, 'list', 0);
Req()(proto, 'list', 1);
Reflect.defineMetadata('design:paramtypes', [CategoryListQueryDto, Object], proto, 'list');
Body()(proto, 'create', 0);
Req()(proto, 'create', 1);
Reflect.defineMetadata('design:paramtypes', [CreateCategoryDto, Object], proto, 'create');
for (const [method, dto] of [
  ['update', UpdateCategoryDto],
  ['archive', ArchiveCategoryDto],
]) {
  Param('categoryId', new ParseUUIDPipe({ version: '4' }))(proto, method, 0);
  Body()(proto, method, 1);
  Req()(proto, method, 2);
  Reflect.defineMetadata('design:paramtypes', [String, dto, Object], proto, method);
}
for (const method of ['list', 'create', 'update', 'archive'])
  RequirePermissions(
    method === 'list' ? PERMISSIONS.EXPENSE_READ : PERMISSIONS.EXPENSE_CATEGORY_MANAGE,
  )(proto, method, Object.getOwnPropertyDescriptor(proto, method));
