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
import { OrganizationInvoiceSettings } from '../../organizations/application/organization-invoice-settings.js';
import { assertExpenseEditable, expenseData, expenseText } from '../domain/expense-policy.js';
import { expenseResponse } from '../expense-response.js';
import { expenseAudit, expenseSnapshot, findCategory, findExpense } from './expense-persistence.js';
import {
  listOptions,
  decodeCursor,
  listFilter,
  listOrder,
  listResponse,
} from './expense-pagination.js';

@Injectable()
export class ExpensesService {
  constructor(prismaService, authorization, settings) {
    this.prismaService = prismaService;
    this.authorization = authorization;
    this.settings = settings;
  }
  resolve(client, context, permission) {
    requireTenantContext(context);
    return resolveTenantAccess(client, context, context.organizationId, this.authorization, [
      permission,
    ]);
  }
  async activeCategory(tx, tenant, id) {
    const category = await findCategory(tx, tenant, id, true);
    if (category.status !== 'ACTIVE')
      throw new ApplicationError(
        ERROR_CODES.EXPENSE_CATEGORY_INACTIVE,
        'Expense category is inactive.',
      );
  }
  async create(context, input, metadata = {}) {
    const client = await this.prismaService.getClient();
    const row = await client.$transaction(
      async (tx) => {
        const { tenant } = await this.resolve(tx, context, PERMISSIONS.EXPENSE_CREATE);
        const organization = await this.settings.lock(tx, tenant, true);
        const data = expenseData(input, organization.baseCurrency);
        await this.activeCategory(tx, tenant, data.expenseCategoryId);
        const created = await tx.expense.create({
          data: {
            ...data,
            organizationId: tenant.organizationId,
            currency: organization.baseCurrency,
            createdByUserId: tenant.userId,
          },
          include: { category: true },
        });
        await expenseAudit(
          tx,
          tenant,
          'Expense',
          'EXPENSE_CREATED',
          created.id,
          null,
          expenseSnapshot(created),
          metadata,
        );
        return created;
      },
      { isolationLevel: 'ReadCommitted', timeout: 15000 },
    );
    return expenseResponse(row);
  }
  async list(context, query = {}) {
    const client = await this.prismaService.getClient();
    const { tenant } = await this.resolve(client, context, PERMISSIONS.EXPENSE_READ);
    const options = listOptions(tenant.organizationId, query);
    const rows = await client.expense.findMany({
      where: tenantWhere(tenant, listFilter(options, decodeCursor(query.after, options))),
      orderBy: listOrder(options),
      take: options.limit + 1,
      include: { category: true },
    });
    return listResponse(rows, options, expenseResponse);
  }
  async get(context, id) {
    const client = await this.prismaService.getClient();
    const { tenant } = await this.resolve(client, context, PERMISSIONS.EXPENSE_READ);
    return expenseResponse(await findExpense(client, tenant, id));
  }
  async update(context, id, version, input, metadata = {}) {
    const client = await this.prismaService.getClient();
    const row = await client.$transaction(
      async (tx) => {
        const { tenant } = await this.resolve(tx, context, PERMISSIONS.EXPENSE_UPDATE);
        const before = await findExpense(tx, tenant, id, true);
        assertExpenseEditable(before, version);
        const data = expenseData(input, before.currency);
        if (!Object.keys(data).length)
          throw new ApplicationError(
            ERROR_CODES.INVALID_REQUEST,
            'At least one expense field is required.',
          );
        if (data.expenseCategoryId && data.expenseCategoryId !== before.expenseCategoryId)
          await this.activeCategory(tx, tenant, data.expenseCategoryId);
        const changed = await tx.expense.updateMany({
          where: { ...tenantResourceWhere(tenant, id), status: 'ACTIVE', version },
          data: { ...data, version: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw new ApplicationError(
            ERROR_CODES.CONCURRENT_MODIFICATION,
            'Expense version does not match.',
          );
        const updated = await findExpense(tx, tenant, id);
        await expenseAudit(
          tx,
          tenant,
          'Expense',
          'EXPENSE_UPDATED',
          id,
          expenseSnapshot(before),
          expenseSnapshot(updated),
          metadata,
          input.notes !== undefined && input.notes !== before.notes ? ['notes'] : [],
        );
        return updated;
      },
      { isolationLevel: 'ReadCommitted', timeout: 15000 },
    );
    return expenseResponse(row);
  }
  async void(context, id, version, input, metadata = {}) {
    const client = await this.prismaService.getClient();
    const row = await client.$transaction(
      async (tx) => {
        const { tenant } = await this.resolve(tx, context, PERMISSIONS.EXPENSE_VOID);
        const before = await findExpense(tx, tenant, id, true);
        assertExpenseEditable(before, version, true);
        const changed = await tx.expense.updateMany({
          where: { ...tenantResourceWhere(tenant, id), status: 'ACTIVE', version },
          data: {
            status: 'VOIDED',
            voidReason: expenseText(input.reason, 500),
            voidedByUserId: tenant.userId,
            voidedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1)
          throw new ApplicationError(
            ERROR_CODES.CONCURRENT_MODIFICATION,
            'Expense version does not match.',
          );
        const updated = await findExpense(tx, tenant, id);
        await expenseAudit(
          tx,
          tenant,
          'Expense',
          'EXPENSE_VOIDED',
          id,
          expenseSnapshot(before),
          expenseSnapshot(updated),
          metadata,
        );
        return updated;
      },
      { isolationLevel: 'ReadCommitted', timeout: 15000 },
    );
    return expenseResponse(row);
  }
}
Inject(PrismaService)(ExpensesService, undefined, 0);
Inject(AuthorizationService)(ExpensesService, undefined, 1);
Inject(OrganizationInvoiceSettings)(ExpensesService, undefined, 2);
