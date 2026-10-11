import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { ExpensesService } from './expenses.service.js';
import { ExpenseCategoriesService } from './expense-categories.service.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import { resolveTenantAccess } from '../../../common/tenancy/tenant-context.js';

describe('expense application transaction boundaries', () => {
  let tx, root, tenant, expenses, categories, settings, row, category;
  const input = {
    categoryId: 'category',
    amount: '10',
    expenseDate: '2026-01-01',
    description: 'Office',
    notes: 'private memo',
  };
  beforeEach(async () => {
    category = {
      id: 'category',
      organizationId: 'tenant',
      name: 'Office',
      normalizedName: 'office',
      status: 'ACTIVE',
      description: null,
      systemKey: null,
    };
    row = {
      id: 'expense',
      organizationId: 'tenant',
      expenseCategoryId: 'category',
      category,
      amount: new Prisma.Decimal('10'),
      currency: 'INR',
      expenseDate: new Date('2026-01-01'),
      description: 'Office',
      status: 'ACTIVE',
      version: 1,
      createdByUserId: 'user',
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null,
    };
    tx = {
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'member',
          organizationId: 'tenant',
          role: 'OWNER',
          organization: { baseCurrency: 'INR' },
        }),
      },
      $queryRaw: jest.fn(),
      expenseCategory: {
        findFirst: jest.fn().mockResolvedValue(category),
        create: jest.fn().mockResolvedValue(category),
        update: jest.fn().mockResolvedValue(category),
      },
      expense: {
        findFirst: jest.fn().mockResolvedValue(row),
        create: jest.fn().mockResolvedValue(row),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn() },
    };
    root = { $transaction: jest.fn(async (operation) => operation(tx)) };
    const authorization = new AuthorizationService();
    tenant = (
      await resolveTenantAccess(
        tx,
        { userId: 'user', sessionId: 'session' },
        'tenant',
        authorization,
        [PERMISSIONS.EXPENSE_CREATE],
      )
    ).tenant;
    settings = { lock: jest.fn().mockResolvedValue({ baseCurrency: 'INR' }) };
    expenses = new ExpensesService({ getClient: async () => root }, authorization, settings);
    categories = new ExpenseCategoriesService({ getClient: async () => root }, authorization);
    tx.membership.findFirst.mockClear();
  });
  it('uses the same transaction for reauthorization, settings, locks, mutation and trusted audit', async () => {
    expect(await expenses.create(tenant, input, { requestId: 'req' })).toMatchObject({
      amount: '10.00',
      version: 1,
    });
    expect(settings.lock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ organizationId: 'tenant' }),
      true,
    );
    expect(tx.membership.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.expense.create.mock.calls[0][0].data).toMatchObject({
      organizationId: 'tenant',
      createdByUserId: 'user',
      currency: 'INR',
      amount: new Prisma.Decimal('10'),
    });
    const audit = tx.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({
      actorUserId: 'user',
      actorMembershipId: 'member',
      actorSessionId: 'session',
      action: 'EXPENSE_CREATED',
      requestId: 'req',
    });
    expect(JSON.stringify(audit)).not.toContain('private memo');
    expect(root.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'ReadCommitted',
      timeout: 15000,
    });
  });
  it('propagates mandatory audit failure from both application services', async () => {
    tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(expenses.create(tenant, input)).rejects.toThrow('audit unavailable');
    await expect(categories.create(tenant, { name: 'Office' })).rejects.toThrow(
      'audit unavailable',
    );
  });
  it('rejects copied context and transaction-time permission changes before financial writes', async () => {
    await expect(expenses.create({ ...tenant }, input)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    tx.membership.findFirst.mockResolvedValue({
      id: 'member',
      organizationId: 'tenant',
      role: 'VIEWER',
    });
    await expect(expenses.create(tenant, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(settings.lock).not.toHaveBeenCalled();
    expect(tx.expense.create).not.toHaveBeenCalled();
  });
  it('does not require active status for unchanged archived categories; locks changed assignments', async () => {
    category.status = 'ARCHIVED';
    await expenses.update(tenant, row.id, 1, { categoryId: 'category', notes: null });
    expect(tx.expenseCategory.findFirst).not.toHaveBeenCalled();
    expect(tx.expense.updateMany.mock.calls[0][0].where).toMatchObject({
      id: 'expense',
      organizationId: 'tenant',
      status: 'ACTIVE',
      version: 1,
    });
    expect(tx.expense.updateMany.mock.calls[0][0].data.version).toEqual({ increment: 1 });
    await expect(
      expenses.update(tenant, row.id, 1, { categoryId: 'new-category' }),
    ).rejects.toMatchObject({ code: 'EXPENSE_CATEGORY_INACTIVE' });
  });
  it('returns already archived categories without write/audit and rejects archived PATCH', async () => {
    category.status = 'ARCHIVED';
    expect(await categories.archive(tenant, category.id)).toMatchObject({ status: 'ARCHIVED' });
    expect(tx.expenseCategory.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    await expect(categories.update(tenant, category.id, { name: 'New' })).rejects.toMatchObject({
      code: 'EXPENSE_CATEGORY_NOT_EDITABLE',
    });
  });
});
