import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import {
  requireTenantContext,
  resolveTenantAccess,
} from '../../../common/tenancy/tenant-context.js';
import { tenantResourceWhere, tenantWhere } from '../../../database/helpers/tenant-query.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { categoryData } from '../domain/expense-policy.js';
import { categoryResponse } from '../expense-response.js';
import { categorySnapshot, expenseAudit, findCategory } from './expense-persistence.js';
import {
  listOptions,
  decodeCursor,
  listFilter,
  listOrder,
  listResponse,
} from './expense-pagination.js';

@Injectable()
export class ExpenseCategoriesService {
  constructor(prismaService, authorization) {
    this.prismaService = prismaService;
    this.authorization = authorization;
  }
  resolve(client, context, permission) {
    requireTenantContext(context);
    return resolveTenantAccess(client, context, context.organizationId, this.authorization, [
      permission,
    ]);
  }
  async list(context, query = {}) {
    const client = await this.prismaService.getClient();
    const { tenant } = await this.resolve(client, context, PERMISSIONS.EXPENSE_READ);
    const options = listOptions(tenant.organizationId, query, true);
    const rows = await client.expenseCategory.findMany({
      where: tenantWhere(tenant, listFilter(options, decodeCursor(query.after, options))),
      orderBy: listOrder(options),
      take: options.limit + 1,
    });
    return listResponse(rows, options, categoryResponse);
  }
  async create(context, input, metadata = {}) {
    const client = await this.prismaService.getClient();
    try {
      return categoryResponse(
        await client.$transaction(async (tx) => {
          const { tenant } = await this.resolve(tx, context, PERMISSIONS.EXPENSE_CATEGORY_MANAGE);
          const data = categoryData(input);
          if (!data.name)
            throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Category name is required.');
          const row = await tx.expenseCategory.create({
            data: { ...data, organizationId: tenant.organizationId },
          });
          await expenseAudit(
            tx,
            tenant,
            'ExpenseCategory',
            'EXPENSE_CATEGORY_CREATED',
            row.id,
            null,
            categorySnapshot(row),
            metadata,
          );
          return row;
        }),
      );
    } catch (error) {
      this.persistenceError(error);
    }
  }
  async update(context, id, input, metadata = {}) {
    const client = await this.prismaService.getClient();
    try {
      return categoryResponse(
        await client.$transaction(async (tx) => {
          const { tenant } = await this.resolve(tx, context, PERMISSIONS.EXPENSE_CATEGORY_MANAGE);
          const before = await findCategory(tx, tenant, id, true);
          if (before.status !== 'ACTIVE')
            throw new ApplicationError(
              ERROR_CODES.EXPENSE_CATEGORY_NOT_EDITABLE,
              'Archived category cannot be edited.',
            );
          const data = categoryData(input);
          if (!Object.keys(data).length)
            throw new ApplicationError(
              ERROR_CODES.INVALID_REQUEST,
              'At least one category field is required.',
            );
          const row = await tx.expenseCategory.update({
            where: tenantResourceWhere(tenant, id),
            data,
          });
          await expenseAudit(
            tx,
            tenant,
            'ExpenseCategory',
            'EXPENSE_CATEGORY_UPDATED',
            id,
            categorySnapshot(before),
            categorySnapshot(row),
            metadata,
          );
          return row;
        }),
      );
    } catch (error) {
      this.persistenceError(error);
    }
  }
  async archive(context, id, metadata = {}) {
    const client = await this.prismaService.getClient();
    return categoryResponse(
      await client.$transaction(async (tx) => {
        const { tenant } = await this.resolve(tx, context, PERMISSIONS.EXPENSE_CATEGORY_MANAGE);
        const before = await findCategory(tx, tenant, id, true);
        if (before.status === 'ARCHIVED') return before;
        const row = await tx.expenseCategory.update({
          where: tenantResourceWhere(tenant, id),
          data: { status: 'ARCHIVED' },
        });
        await expenseAudit(
          tx,
          tenant,
          'ExpenseCategory',
          'EXPENSE_CATEGORY_ARCHIVED',
          id,
          categorySnapshot(before),
          categorySnapshot(row),
          metadata,
        );
        return row;
      }),
    );
  }
  persistenceError(error) {
    if (error?.code === 'P2002')
      throw new ApplicationError(
        ERROR_CODES.EXPENSE_CATEGORY_ALREADY_EXISTS,
        'Expense category name is unavailable.',
      );
    throw error;
  }
}
Inject(PrismaService)(ExpenseCategoriesService, undefined, 0);
Inject(AuthorizationService)(ExpenseCategoriesService, undefined, 1);
