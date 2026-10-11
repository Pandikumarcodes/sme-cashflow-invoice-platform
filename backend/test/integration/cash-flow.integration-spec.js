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
describe('cash flow PostgreSQL facts, isolation and snapshot', () => {
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
  const service = new CashFlowService(provider, authorization, reader);
  const range = { fromDate: '2026-01-01', toDate: '2026-02-28', groupBy: 'day' };
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
  it('derives only current source facts, excludes reversed/voided rows and never subtracts reversals twice', async () => {
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
    const auditBefore = await prisma.auditLog.count();
    const eventsBefore = await prisma.pendingEvent.count();
    expect((await service.get(a.tenant, range)).data).toEqual({
      inflows: '0.30',
      outflows: '0.40',
      netCashFlow: '-0.10',
      series: [
        { periodStart: '2026-01-01', inflows: '0.10', outflows: '0.40', netCashFlow: '-0.30' },
        { periodStart: '2026-02-28', inflows: '0.20', outflows: '0.00', netCashFlow: '0.20' },
      ],
    });
    expect(await prisma.auditLog.count()).toBe(auditBefore);
    expect(await prisma.pendingEvent.count()).toBe(eventsBefore);
    expect(
      (await service.get(a.tenant, { fromDate: '2026-03-01', toDate: '2026-03-01' })).data.series,
    ).toEqual([]);
  });
  it('isolates both branches and ignores issue/creation timestamps and out-of-range facts', async () => {
    await record(a, '2', '2026-01-01');
    await record(a, '3', '2026-02-28');
    await record(a, '100', '2025-12-31');
    await record(a, '100', '2026-03-01');
    await spend(a, '1', '2026-02-28');
    await spend(a, '100', '2026-03-01');
    await record(b, '900', '2026-01-01');
    await spend(b, '500', '2026-02-28');
    expect((await service.get(a.tenant, range)).data).toMatchObject({
      inflows: '5.00',
      outflows: '1.00',
      netCashFlow: '4.00',
    });
    expect((await service.get(b.tenant, range)).data).toMatchObject({
      inflows: '900.00',
      outflows: '500.00',
    });
  });
  it('groups ISO Monday weeks and calendar months chronologically without filling gaps', async () => {
    await record(a, '2', '2026-02-28');
    await record(a, '1', '2026-01-01');
    await spend(a, '3', '2026-01-04');
    const weeks = (await service.get(a.tenant, { ...range, groupBy: 'week' })).data.series;
    expect(weeks.map((row) => row.periodStart)).toEqual(['2025-12-29', '2026-02-23']);
    expect(weeks[0]).toMatchObject({ inflows: '1.00', outflows: '3.00', netCashFlow: '-2.00' });
    expect(
      (await service.get(a.tenant, { ...range, groupBy: 'month' })).data.series.map(
        (row) => row.periodStart,
      ),
    ).toEqual(['2026-01-01', '2026-02-01']);
  });
  it('supports payment-only, expense-only and empty reports without joining invoice/category eligibility', async () => {
    expect((await service.get(a.tenant, range)).data.series).toEqual([]);
    await record(a, '1', '2026-01-01');
    expect((await service.get(a.tenant, range)).data).toMatchObject({
      inflows: '1.00',
      outflows: '0.00',
    });
    await spend(b, '2', '2026-01-01');
    expect((await service.get(b.tenant, range)).data).toMatchObject({
      inflows: '0.00',
      outflows: '2.00',
    });
  });
  it('preserves Decimal sums exceeding the maximum individual amount', async () => {
    await spend(a, '999999999999999.99', '2026-01-01');
    await spend(a, '999999999999999.99', '2026-01-01');
    expect((await service.get(a.tenant, range)).data).toMatchObject({
      outflows: '1999999999999999.98',
      netCashFlow: '-1999999999999999.98',
    });
  });
  it('reauthorizes current membership, allows Viewer analytics and rejects forged contexts', async () => {
    await expect(service.get({ ...a.tenant }, range)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await prisma.membership.update({
      where: { id: a.tenant.membershipId },
      data: { role: 'VIEWER' },
    });
    await expect(service.get(a.tenant, range)).resolves.toHaveProperty('data');
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
  it('fails closed on a mixed-currency fact rather than silently dropping it', async () => {
    const expense = await spend(a, '1', '2026-01-01');
    await prisma.expense.update({ where: { id: expense.id }, data: { currency: 'USD' } });
    await expect(service.get(a.tenant, range)).rejects.toMatchObject({ code: 'CURRENCY_MISMATCH' });
  });
  it('reads one repeatable snapshot even when a correction commits during aggregation', async () => {
    const expense = await spend(a, '5', '2026-01-01');
    const concurrentReader = {
      read: async (...args) => {
        await expenses.void(a.tenant, expense.id, 1, { reason: 'Concurrent correction' });
        return reader.read(...args);
      },
    };
    const snapshotService = new CashFlowService(provider, authorization, concurrentReader);
    expect((await snapshotService.get(a.tenant, range)).data.outflows).toBe('5.00');
    expect((await service.get(a.tenant, range)).data.outflows).toBe('0.00');
  });
});
