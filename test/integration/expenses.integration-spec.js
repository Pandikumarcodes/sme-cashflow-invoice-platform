import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AuthorizationService } from '../../src/common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../src/common/authorization/permissions.js';
import { resolveTenantAccess } from '../../src/common/tenancy/tenant-context.js';
import { ExpenseCategoriesService } from '../../src/modules/expenses/application/expense-categories.service.js';
import { ExpensesService } from '../../src/modules/expenses/application/expenses.service.js';
import { OrganizationInvoiceSettings } from '../../src/modules/organizations/application/organization-invoice-settings.js';
import { OrganizationsService } from '../../src/modules/organizations/application/organizations.service.js';
import { clearDatabase, createTestPrismaClient } from './database-test-helpers.js';

jest.setTimeout(30000);
describe('expense persistence, isolation and atomicity', () => {
  const prisma = createTestPrismaClient();
  const authorization = new AuthorizationService();
  const persistence = { getClient: async () => prisma };
  const categories = new ExpenseCategoriesService(persistence, authorization);
  const expenses = new ExpensesService(
    persistence,
    authorization,
    new OrganizationInvoiceSettings(),
  );
  const organizations = new OrganizationsService(persistence, authorization);
  let a, b, category;
  const input = (extra = {}) => ({
    categoryId: category.id,
    amount: '12.34',
    expenseDate: '2026-02-01',
    description: ' Work ',
    ...extra,
  });
  async function dropTrigger() {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_expense_audit ON "audit_logs"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_expense_audit()');
  }
  async function fixture(name) {
    const user = await prisma.user.create({
      data: {
        email: name + '@example.com',
        normalizedEmail: name + '@example.com',
        passwordHash: 'integration-only',
        firstName: name,
        lastName: 'Owner',
      },
    });
    const organization = await prisma.organization.create({
      data: { legalName: name, displayName: name, baseCurrency: 'INR', timezone: 'Asia/Kolkata' },
    });
    await prisma.membership.create({
      data: { organizationId: organization.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' },
    });
    return (
      await resolveTenantAccess(
        prisma,
        { userId: user.id, sessionId: randomUUID() },
        organization.id,
        authorization,
        [PERMISSIONS.EXPENSE_CREATE],
      )
    ).tenant;
  }
  beforeEach(async () => {
    await dropTrigger();
    await clearDatabase(prisma);
    a = await fixture('expense-a');
    b = await fixture('expense-b');
    category = await categories.create(a, { name: 'Office' });
  });
  afterEach(dropTrigger);
  afterAll(async () => prisma.$disconnect());
  it('normalizes tenant-unique names; preserves system keys and archives defaults idempotently', async () => {
    await expect(categories.create(a, { name: ' OFFICE ' })).rejects.toMatchObject({
      code: 'EXPENSE_CATEGORY_ALREADY_EXISTS',
    });
    await expect(categories.create(b, { name: 'Office' })).resolves.toMatchObject({
      name: 'Office',
    });
    const other = await categories.create(a, { name: 'Other' });
    await expect(categories.update(a, other.id, { name: 'Office' })).rejects.toMatchObject({
      code: 'EXPENSE_CATEGORY_ALREADY_EXISTS',
    });
    const defaultCategory = await prisma.expenseCategory.create({
      data: {
        organizationId: a.organizationId,
        name: 'Rent',
        normalizedName: 'rent',
        systemKey: 'RENT',
      },
    });
    await expect(
      prisma.expenseCategory.create({
        data: {
          organizationId: a.organizationId,
          name: 'Rent2',
          normalizedName: 'rent2',
          systemKey: 'RENT',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    const updated = await categories.update(a, defaultCategory.id, { name: ' Property Rent ' });
    expect(updated.systemKey).toBe('RENT');
    const archived = await categories.archive(a, defaultCategory.id);
    const repeat = await categories.archive(a, defaultCategory.id);
    expect(repeat).toEqual(archived);
    expect(repeat.systemKey).toBe('RENT');
    await expect(
      categories.update(a, defaultCategory.id, { name: 'Forbidden' }),
    ).rejects.toMatchObject({ code: 'EXPENSE_CATEGORY_NOT_EDITABLE' });
    expect(
      await prisma.auditLog.count({
        where: { entityId: defaultCategory.id, action: 'EXPENSE_CATEGORY_ARCHIVED' },
      }),
    ).toBe(1);
    expect((await categories.list(a)).data.every((row) => row.status === 'ACTIVE')).toBe(true);
  });
  it('conceals every foreign/missing resource and rejects forged tenant context', async () => {
    const foreignCategory = await categories.create(b, { name: 'Foreign' });
    const foreignExpense = await expenses.create(b, input({ categoryId: foreignCategory.id }));
    for (const id of [foreignCategory.id, randomUUID()]) {
      for (const call of [
        () => categories.update(a, id, { name: 'Attack' }),
        () => categories.archive(a, id),
        () => expenses.create(a, input({ categoryId: id })),
      ])
        await expect(call()).rejects.toMatchObject({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Expense category not found.',
        });
    }
    for (const id of [foreignExpense.id, randomUUID()])
      for (const call of [
        () => expenses.get(a, id),
        () => expenses.update(a, id, 1, { description: 'Attack' }),
        () => expenses.void(a, id, 1, { reason: 'Attack' }),
      ])
        await expect(call()).rejects.toMatchObject({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Expense not found.',
        });
    await expect(expenses.list({ ...a })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect((await expenses.list(a)).data).toEqual([]);
    expect((await categories.list(a)).data.map((row) => row.id)).toEqual([category.id]);
  });
  it('enforces composite category FK, delete restriction, numeric bounds and lifecycle checks in PostgreSQL', async () => {
    const foreign = await categories.create(b, { name: 'Foreign' });
    const data = {
      organizationId: a.organizationId,
      expenseCategoryId: category.id,
      amount: new Prisma.Decimal('1.2345'),
      currency: 'CLF',
      expenseDate: new Date('2026-01-01'),
      description: 'Test',
      createdByUserId: a.userId,
    };
    await expect(
      prisma.expense.create({ data: { ...data, expenseCategoryId: foreign.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const stored = await prisma.expense.create({ data });
    expect(stored.amount.toString()).toBe('1.2345');
    await expect(
      prisma.expenseCategory.delete({ where: { id: category.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    for (const amount of ['0', '-1', '1000000000000000'])
      await expect(
        prisma.expense.create({ data: { ...data, amount: new Prisma.Decimal(amount) } }),
      ).rejects.toThrow();
    await expect(
      prisma.expense.update({ where: { id: stored.id }, data: { status: 'VOIDED' } }),
    ).rejects.toThrow();
    await expect(
      prisma.expense.update({ where: { id: stored.id }, data: { voidReason: 'Wrong' } }),
    ).rejects.toThrow();
  });
  it('locks organization currency on first expense permanently and snapshots current settings', async () => {
    const created = await expenses.create(
      a,
      input({ vendorPayee: ' Vendor ', reference: ' REF ', notes: 'private notes' }),
      { requestId: 'expense-create' },
    );
    expect(created).toMatchObject({
      amount: '12.34',
      currency: 'INR',
      description: 'Work',
      vendorPayee: 'Vendor',
      reference: 'REF',
      status: 'ACTIVE',
      version: 1,
      createdByUserId: a.userId,
    });
    const organization = await prisma.organization.findUnique({ where: { id: a.organizationId } });
    expect(organization.currencyLockedAt).toBeInstanceOf(Date);
    expect(organization.version).toBe(2);
    await expenses.create(a, input());
    expect(
      (await prisma.organization.findUnique({ where: { id: a.organizationId } })).version,
    ).toBe(2);
    await expenses.void(a, created.id, 1, { reason: ' correction ' });
    await expect(
      organizations.update(a, a.organizationId, 2, { baseCurrency: 'JPY' }),
    ).rejects.toMatchObject({ code: 'CURRENCY_LOCKED' });
    expect(
      (await prisma.organization.findUnique({ where: { id: a.organizationId } })).currencyLockedAt,
    ).toEqual(organization.currencyLockedAt);
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: created.id, action: 'EXPENSE_CREATED' },
    });
    expect(audit).toMatchObject({
      actorUserId: a.userId,
      actorMembershipId: a.membershipId,
      actorSessionId: a.sessionId,
      source: 'API',
      requestId: 'expense-create',
    });
    expect(JSON.stringify(audit)).not.toContain('private notes');
    expect(await prisma.pendingEvent.count()).toBe(0);
    expect(await prisma.idempotencyRecord.count()).toBe(0);
  });
  it('retains archived references for unchanged assignment, rejects new assignment, and preserves void history', async () => {
    const row = await expenses.create(
      a,
      input({ notes: 'memo', reference: 'R', vendorPayee: 'Vendor' }),
    );
    await categories.archive(a, category.id);
    await expect(expenses.create(a, input())).rejects.toMatchObject({
      code: 'EXPENSE_CATEGORY_INACTIVE',
    });
    const updated = await expenses.update(a, row.id, 1, {
      categoryId: category.id,
      description: 'Corrected',
      notes: null,
      reference: null,
      vendorPayee: null,
    });
    expect(updated).toMatchObject({
      version: 2,
      notes: null,
      reference: null,
      vendorPayee: null,
      category: { status: 'ARCHIVED' },
    });
    const inactive = await categories.create(a, { name: 'Inactive' });
    await categories.archive(a, inactive.id);
    await expect(expenses.update(a, row.id, 2, { categoryId: inactive.id })).rejects.toMatchObject({
      code: 'EXPENSE_CATEGORY_INACTIVE',
    });
    await expect(expenses.update(a, row.id, 1, { amount: '10' })).rejects.toMatchObject({
      code: 'CONCURRENT_MODIFICATION',
    });
    await expect(expenses.void(a, row.id, 1, { reason: 'Wrong' })).rejects.toMatchObject({
      code: 'CONCURRENT_MODIFICATION',
    });
    const voided = await expenses.void(a, row.id, 2, { reason: ' wrong entry ' });
    expect(voided).toMatchObject({
      status: 'VOIDED',
      version: 3,
      voidReason: 'wrong entry',
      voidedByUserId: a.userId,
      category: { status: 'ARCHIVED' },
    });
    await expect(expenses.void(a, row.id, 3, { reason: 'Again' })).rejects.toMatchObject({
      code: 'EXPENSE_ALREADY_VOIDED',
    });
    await expect(expenses.update(a, row.id, 3, { description: 'Again' })).rejects.toMatchObject({
      code: 'EXPENSE_NOT_EDITABLE',
    });
    expect((await expenses.list(a)).data).toEqual([]);
    expect((await expenses.list(a, { status: 'VOIDED' })).data).toHaveLength(1);
    expect(await expenses.get(a, row.id)).toMatchObject({ status: 'VOIDED' });
  });
  it('rolls back all six commands and first currency lock when mandatory audit insertion fails', async () => {
    const expense = await expenses.create(a, input());
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION test_fail_expense_audit() RETURNS trigger AS $$ BEGIN IF NEW."entityType" IN ('Expense','ExpenseCategory') THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER test_fail_expense_audit BEFORE INSERT ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION test_fail_expense_audit()',
    );
    for (const call of [
      () => categories.create(a, { name: 'Rolled back' }),
      () => categories.update(a, category.id, { name: 'Changed' }),
      () => categories.archive(a, category.id),
      () => expenses.create(a, input()),
      () => expenses.update(a, expense.id, 1, { amount: '20' }),
      () => expenses.void(a, expense.id, 1, { reason: 'Wrong' }),
    ])
      await expect(call()).rejects.toThrow();
    expect(await prisma.expenseCategory.findUnique({ where: { id: category.id } })).toMatchObject({
      name: 'Office',
      status: 'ACTIVE',
    });
    expect(await prisma.expense.findUnique({ where: { id: expense.id } })).toMatchObject({
      status: 'ACTIVE',
      version: 1,
      amount: new Prisma.Decimal('12.34'),
    });
    expect(await prisma.expense.count()).toBe(1);
    expect(await prisma.expenseCategory.count()).toBe(1);
    await dropTrigger();
    const otherCategory = await categories.create(b, { name: 'Other' });
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION test_fail_expense_audit() RETURNS trigger AS $$ BEGIN IF NEW."entityType" = 'Expense' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER test_fail_expense_audit BEFORE INSERT ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION test_fail_expense_audit()',
    );
    await expect(expenses.create(b, input({ categoryId: otherCategory.id }))).rejects.toThrow();
    expect(await prisma.organization.findUnique({ where: { id: b.organizationId } })).toMatchObject(
      { currencyLockedAt: null, version: 1 },
    );
  });
  it('permits exactly one same-version update and one archive audit under concurrency', async () => {
    const row = await expenses.create(a, input());
    const results = await Promise.allSettled([
      expenses.update(a, row.id, 1, { description: 'First' }),
      expenses.update(a, row.id, 1, { description: 'Second' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason.code).toBe(
      'CONCURRENT_MODIFICATION',
    );
    expect(await prisma.auditLog.count({ where: { action: 'EXPENSE_UPDATED' } })).toBe(1);
    const archiveResults = await Promise.all([
      categories.archive(a, category.id),
      categories.archive(a, category.id),
    ]);
    expect(archiveResults[0]).toEqual(archiveResults[1]);
    expect(await prisma.auditLog.count({ where: { action: 'EXPENSE_CATEGORY_ARCHIVED' } })).toBe(1);
  });
  it('serializes update versus void and never edits a terminal expense', async () => {
    const row = await expenses.create(a, input());
    const results = await Promise.allSettled([
      expenses.update(a, row.id, 1, { description: 'Corrected' }),
      expenses.void(a, row.id, 1, { reason: 'Wrong' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const current = await expenses.get(a, row.id);
    if (current.status === 'ACTIVE')
      await expenses.void(a, row.id, current.version, { reason: 'Wrong' });
    await expect(
      expenses.update(a, row.id, 2, { description: 'Terminal edit' }),
    ).rejects.toMatchObject({ code: 'EXPENSE_NOT_EDITABLE' });
  });
  it('serializes archive versus new assignment on the same category lock', async () => {
    let release, locked;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const ready = new Promise((resolve) => {
      locked = resolve;
    });
    const archive = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "expense_categories" WHERE "organizationId" = ${a.organizationId}::uuid AND "id" = ${category.id}::uuid FOR UPDATE`;
      await tx.expenseCategory.update({ where: { id: category.id }, data: { status: 'ARCHIVED' } });
      locked();
      await gate;
    });
    await ready;
    const original = expenses.activeCategory.bind(expenses);
    const spy = jest.spyOn(expenses, 'activeCategory').mockImplementation(async (...args) => {
      release();
      return original(...args);
    });
    try {
      await expect(expenses.create(a, input())).rejects.toMatchObject({
        code: 'EXPENSE_CATEGORY_INACTIVE',
      });
      await archive;
      expect(await prisma.expense.count()).toBe(0);
      expect(
        (await prisma.organization.findUnique({ where: { id: a.organizationId } }))
          .currencyLockedAt,
      ).toBeNull();
    } finally {
      release();
      spy.mockRestore();
      await archive;
    }
  });
  it('serializes a currency settings race with first expense creation', async () => {
    const results = await Promise.allSettled([
      expenses.create(a, input({ amount: '10' })),
      organizations.update(a, a.organizationId, 1, { baseCurrency: 'JPY' }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    const organization = await prisma.organization.findUnique({ where: { id: a.organizationId } });
    expect(results[0].value.currency).toBe(organization.baseCurrency);
    expect(organization.currencyLockedAt).toBeInstanceOf(Date);
    if (results[1].status === 'rejected')
      expect(['CURRENCY_LOCKED', 'CONCURRENT_MODIFICATION']).toContain(results[1].reason.code);
  });
  it('rechecks current membership during services, with no trust in stale or copied contexts', async () => {
    const row = await expenses.create(a, input());
    await prisma.membership.update({ where: { id: a.membershipId }, data: { role: 'VIEWER' } });
    await expect(categories.create(a, { name: 'Denied' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(expenses.update(a, row.id, 1, { amount: '2' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(expenses.get(a, row.id)).resolves.toMatchObject({ id: row.id });
    await prisma.membership.update({
      where: { id: a.membershipId },
      data: { status: 'SUSPENDED' },
    });
    await expect(expenses.get(a, row.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
