import { ProfitLossService } from '../../src/modules/profit-loss/application/profit-loss.service.js';
import { ProfitLossReader } from '../../src/modules/financial/infrastructure/profit-loss-reader.js';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { AuthorizationService } from '../../src/common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../src/common/authorization/permissions.js';
import { resolveTenantAccess } from '../../src/common/tenancy/tenant-context.js';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service.js';
import { InvoiceSettlement } from '../../src/modules/invoices/application/invoice-settlement.js';
import { InvoicesService } from '../../src/modules/invoices/application/invoices.service.js';
import { CustomerInvoiceReader } from '../../src/modules/customers/application/customer-invoice-reader.js';
import { OrganizationInvoiceSettings } from '../../src/modules/organizations/application/organization-invoice-settings.js';
import { OrganizationsService } from '../../src/modules/organizations/application/organizations.service.js';
import { CustomersService } from '../../src/modules/customers/application/customers.service.js';
import { PaymentPersistence } from '../../src/modules/payments/infrastructure/payment-persistence.js';
import { PaymentsService } from '../../src/modules/payments/application/payments.service.js';
import { ExpensesService } from '../../src/modules/expenses/application/expenses.service.js';
import { ExpenseCategoriesService } from '../../src/modules/expenses/application/expense-categories.service.js';
import { CashFlowService } from '../../src/modules/cash-flow/application/cash-flow.service.js';
import { CashFlowReader } from '../../src/modules/financial/infrastructure/cash-flow-reader.js';
import { clearDatabase, createTestPrismaClient } from './database-test-helpers.js';

jest.setTimeout(30000);
describe('profit loss PostgreSQL categories, source facts and snapshot', () => {
  const prisma = createTestPrismaClient();
  const authorization = new AuthorizationService();
  const provider = { getClient: async () => prisma };
  const settings = new OrganizationInvoiceSettings();
  const organizations = new OrganizationsService(provider, authorization);
  const customers = new CustomersService(provider, authorization);
  const invoices = new InvoicesService(
    provider,
    authorization,
    new CustomerInvoiceReader(),
    settings,
  );
  const payments = new PaymentsService(
    provider,
    authorization,
    new InvoiceSettlement(),
    new PaymentPersistence(),
    new IdempotencyService(),
  );
  const expenses = new ExpensesService(provider, authorization, settings);
  const categories = new ExpenseCategoriesService(provider, authorization);
  const reader = new CashFlowReader();
  const cashFlow = new CashFlowService(provider, authorization, reader);
  const service = new ProfitLossService(provider, authorization, new ProfitLossReader(reader));
  const range = { fromDate: '2026-01-01', toDate: '2026-02-28', groupBy: 'month' };
  let a, b;
  async function fixture(name) {
    const user = await prisma.user.create({
      data: {
        email: name + '@example.com',
        normalizedEmail: name + '@example.com',
        passwordHash: 'test-only',
        firstName: name,
        lastName: 'Owner',
      },
    });
    const identity = { userId: user.id, sessionId: randomUUID() };
    const organization = await organizations.create(identity, {
      legalName: name,
      baseCurrency: 'INR',
      timezone: 'Asia/Kolkata',
    });
    const { tenant } = await resolveTenantAccess(prisma, identity, organization.id, authorization, [
      PERMISSIONS.ANALYTICS_READ,
    ]);
    const customer = await customers.create(tenant, { displayName: name });
    const draft = await invoices.create(tenant, {
      customerId: customer.id,
      issueDate: '2026-01-01',
      dueDate: '2026-01-31',
      discount: { type: 'NONE', value: '0' },
      taxRate: '0',
      items: [{ description: 'Work', quantity: '1', unitPrice: '1000', sortOrder: 0 }],
    });
    const invoice = await invoices.issue(tenant, draft.id, 1);
    const category = (await categories.list(tenant)).data[0];
    return { tenant, invoice, category };
  }
  const record = (f, amount, paymentDate) =>
    payments.record(
      f.tenant,
      f.invoice.id,
      { amount, paymentDate, method: 'BANK_TRANSFER' },
      randomUUID(),
    );
  const spend = (f, amount, expenseDate) =>
    expenses.create(f.tenant, {
      categoryId: f.category.id,
      amount,
      expenseDate,
      description: 'Costs',
    });
  beforeEach(async () => {
    await clearDatabase(prisma);
    a = await fixture('cash-a');
    b = await fixture('cash-b');
  });
  afterAll(async () => prisma.$disconnect());

  it('uses current source states, includes archived categories and reconciles to Cash Flow without read writes', async () => {
    const reversed = await record(a, '10.10', '2026-01-01');
    await record(a, '0.10', '2026-01-01');
    await record(a, '0.20', '2026-02-28');
    await payments.reverse(
      a.tenant,
      reversed.data.id,
      { reason: 'Wrong', reversalDate: '2026-03-01' },
      randomUUID(),
    );
    await spend(a, '0.40', '2026-01-01');
    const voided = await spend(a, '99', '2026-02-28');
    await expenses.void(a.tenant, voided.id, 1, { reason: 'Wrong' });
    await categories.archive(a.tenant, a.category.id);
    const before = {
      audits: await prisma.auditLog.count(),
      events: await prisma.pendingEvent.count(),
      organization: await prisma.organization.findUnique({
        where: { id: a.tenant.organizationId },
      }),
    };
    const result = await service.get(a.tenant, range);
    expect(result.data).toEqual({
      revenue: '0.30',
      expenses: '0.40',
      netResult: '-0.10',
      expenseByCategory: [
        { categoryId: a.category.id, categoryName: a.category.name, amount: '0.40' },
      ],
      series: [
        { periodStart: '2026-01-01', revenue: '0.10', expenses: '0.40', netResult: '-0.30' },
        { periodStart: '2026-02-01', revenue: '0.20', expenses: '0.00', netResult: '0.20' },
      ],
    });
    const cash = await cashFlow.get(a.tenant, range);
    expect(result.data.netResult).toBe(cash.data.netCashFlow);
    expect(result.data.revenue).toBe(cash.data.inflows);
    expect(result.data.expenses).toBe(cash.data.outflows);
    expect(await prisma.auditLog.count()).toBe(before.audits);
    expect(await prisma.pendingEvent.count()).toBe(before.events);
    expect(
      await prisma.organization.findUnique({ where: { id: a.tenant.organizationId } }),
    ).toEqual(before.organization);
    expect(
      (
        await service.get(a.tenant, {
          fromDate: '2026-03-01',
          toDate: '2026-03-01',
          groupBy: 'none',
        })
      ).data,
    ).toEqual({ revenue: '0.00', expenses: '0.00', netResult: '0.00', expenseByCategory: [] });
  });
  it('scopes revenue, expense totals and same-named categories independently to each tenant and business date', async () => {
    await record(a, '2', '2026-01-01');
    await record(a, '3', '2026-02-28');
    await record(a, '100', '2025-12-31');
    await record(a, '100', '2026-03-01');
    await spend(a, '1', '2026-02-28');
    await spend(a, '100', '2026-03-01');
    await record(b, '900', '2026-01-01');
    await spend(b, '500', '2026-02-28');
    expect((await service.get(a.tenant, range)).data).toMatchObject({
      revenue: '5.00',
      expenses: '1.00',
      netResult: '4.00',
      expenseByCategory: [{ categoryId: a.category.id, amount: '1.00' }],
    });
    expect((await service.get(b.tenant, range)).data).toMatchObject({
      revenue: '900.00',
      expenses: '500.00',
      expenseByCategory: [{ categoryId: b.category.id, amount: '500.00' }],
    });
  });
  it('groups only populated months, clips partial months and omits series for none', async () => {
    await record(a, '2', '2026-02-28');
    await record(a, '1', '2026-01-01');
    await spend(a, '3', '2026-01-04');
    const partial = { fromDate: '2026-01-04', toDate: '2026-02-28', groupBy: 'month' };
    expect((await service.get(a.tenant, partial)).data.series).toEqual([
      { periodStart: '2026-01-01', revenue: '0.00', expenses: '3.00', netResult: '-3.00' },
      { periodStart: '2026-02-01', revenue: '2.00', expenses: '0.00', netResult: '2.00' },
    ]);
    const ungrouped = (await service.get(a.tenant, { ...partial, groupBy: 'none' })).data;
    expect(ungrouped).not.toHaveProperty('series');
    expect(ungrouped).toMatchObject({ revenue: '2.00', expenses: '3.00', netResult: '-1.00' });
  });
  it('returns deterministic category sums with current labels, including renamed/archived categories', async () => {
    await categories.update(a.tenant, a.category.id, { name: 'Archived costs' });
    await spend(a, '1.10', '2026-01-01');
    await spend(a, '2.20', '2026-02-28');
    await categories.archive(a.tenant, a.category.id);
    const other = await categories.create(a.tenant, { name: 'New costs' });
    await spend({ ...a, category: other }, '3.30', '2026-02-01');
    expect((await service.get(a.tenant, range)).data.expenseByCategory).toEqual([
      { categoryId: a.category.id, categoryName: 'Archived costs', amount: '3.30' },
      { categoryId: other.id, categoryName: 'New costs', amount: '3.30' },
    ]);
  });
  it('supports empty, revenue-only and expense-only reports without invoice totals', async () => {
    expect((await service.get(a.tenant, range)).data).toEqual({
      revenue: '0.00',
      expenses: '0.00',
      netResult: '0.00',
      expenseByCategory: [],
      series: [],
    });
    await record(a, '1', '2026-01-01');
    await spend(b, '2', '2026-01-01');
    expect((await service.get(a.tenant, range)).data).toMatchObject({
      revenue: '1.00',
      expenses: '0.00',
      expenseByCategory: [],
    });
    expect((await service.get(b.tenant, range)).data).toMatchObject({
      revenue: '0.00',
      expenses: '2.00',
      netResult: '-2.00',
    });
  });
  it('preserves large Decimal aggregate and category precision', async () => {
    await spend(a, '999999999999999.99', '2026-01-01');
    await spend(a, '999999999999999.99', '2026-01-01');
    expect((await service.get(a.tenant, range)).data).toMatchObject({
      expenses: '1999999999999999.98',
      netResult: '-1999999999999999.98',
      expenseByCategory: [{ amount: '1999999999999999.98' }],
    });
  });
  it('fails closed on mixed payment or expense currencies and rechecks current authorization', async () => {
    const receipt = await record(a, '1', '2026-01-01');
    await prisma.payment.update({ where: { id: receipt.data.id }, data: { currency: 'USD' } });
    await expect(service.get(a.tenant, range)).rejects.toMatchObject({ code: 'CURRENCY_MISMATCH' });
    await prisma.payment.update({ where: { id: receipt.data.id }, data: { currency: 'INR' } });
    const expense = await spend(a, '1', '2026-01-01');
    await prisma.expense.update({ where: { id: expense.id }, data: { currency: 'USD' } });
    await expect(service.get(a.tenant, range)).rejects.toMatchObject({ code: 'CURRENCY_MISMATCH' });
    await expect(service.get({ ...a.tenant }, range)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await prisma.membership.update({
      where: { id: a.tenant.membershipId },
      data: { role: 'MEMBER' },
    });
    await expect(service.get(a.tenant, range)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await prisma.membership.update({
      where: { id: a.tenant.membershipId },
      data: { status: 'SUSPENDED' },
    });
    await expect(service.get(a.tenant, range)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });
  it('keeps totals and category breakdown in the same snapshot during a committed correction', async () => {
    const expense = await spend(a, '5', '2026-01-01');
    const concurrentCash = {
      read: async (...args) => {
        const result = await reader.read(...args);
        await expenses.void(a.tenant, expense.id, 1, { reason: 'Concurrent correction' });
        return result;
      },
    };
    const snapshot = new ProfitLossService(
      provider,
      authorization,
      new ProfitLossReader(concurrentCash),
    );
    expect((await snapshot.get(a.tenant, range)).data).toMatchObject({
      expenses: '5.00',
      expenseByCategory: [{ amount: '5.00' }],
    });
    expect((await service.get(a.tenant, range)).data).toMatchObject({
      expenses: '0.00',
      expenseByCategory: [],
    });
  });
});
