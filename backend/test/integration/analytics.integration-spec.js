import { AnalyticsService } from '../../src/modules/analytics/application/analytics.service.js';
import { AnalyticsReader } from '../../src/modules/financial/infrastructure/analytics-reader.js';
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
describe('analytics PostgreSQL source facts, cohorts and aging', () => {
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
  const service = new AnalyticsService(provider, authorization, new AnalyticsReader(reader));
  const range = { fromDate: '2026-01-01', toDate: '2026-02-28', asOfDate: '2026-03-01' };
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

  async function document(issueDate, dueDate, price = '1000', context = a.tenant) {
    const customer = await customers.create(context, { displayName: 'Additional buyer' });
    return invoices.create(context, {
      customerId: customer.id,
      issueDate,
      dueDate,
      discount: { type: 'NONE', value: '0' },
      taxRate: '0',
      items: [{ description: 'Work', quantity: '1', unitPrice: price, sortOrder: 0 }],
    });
  }
  it('composes canonical cash, balances and counts with current reversals, voids and archived categories', async () => {
    await record(a, '250', '2026-01-01');
    const reversed = await record(a, '25', '2026-02-01');
    await payments.reverse(
      a.tenant,
      reversed.data.id,
      { reason: 'Wrong', reversalDate: '2026-04-01' },
      randomUUID(),
    );
    await spend(a, '30', '2026-01-01');
    const voided = await spend(a, '20', '2026-01-01');
    await expenses.void(a.tenant, voided.id, 1, { reason: 'Wrong' });
    await categories.archive(a.tenant, a.category.id);
    const before = [await prisma.auditLog.count(), await prisma.pendingEvent.count()];
    const result = await service.summary(a.tenant, range);
    expect(result.data).toEqual({
      billing: {
        totalInvoiced: '1000.00',
        invoiceCounts: { DRAFT: 0, ISSUED: 1, CANCELLED: 0, VOID: 0 },
      },
      collections: {
        collected: '250.00',
        rate: '25.0000',
        averagePaymentDelayDays: null,
        sampleSize: 0,
      },
      receivables: { outstanding: '750.00', overdue: '750.00' },
      spending: { expenses: '30.00' },
      cash: { netCashFlow: '220.00', netResult: '220.00' },
      customers: { activeCount: 1 },
    });
    expect(result.data.cash.netCashFlow).toBe(
      (await cashFlow.get(a.tenant, { fromDate: range.fromDate, toDate: range.toDate })).data
        .netCashFlow,
    );
    const aging = await service.aging(a.tenant, { asOfDate: range.asOfDate });
    expect(aging.data).toMatchObject({ outstanding: '750.00', overdue: '750.00' });
    expect(aging.data.buckets[1]).toEqual({ bucket: '1_30', invoiceCount: 1, amount: '750.00' });
    expect([await prisma.auditLog.count(), await prisma.pendingEvent.count()]).toEqual(before);
  });
  it('separates period receipts from issue-cohort collections through as-of and final-payment delay', async () => {
    await record(a, '250', '2026-01-15');
    await record(a, '750', '2026-03-01');
    const prior = await document('2025-12-01', '2025-12-31', '100');
    const issued = await invoices.issue(a.tenant, prior.id, 1);
    await record({ ...a, invoice: issued }, '50', '2026-01-20');
    const result = (await service.summary(a.tenant, range)).data;
    expect(result.billing.totalInvoiced).toBe('1000.00');
    expect(result.collections).toEqual({
      collected: '300.00',
      rate: '100.0000',
      averagePaymentDelayDays: '29.00',
      sampleSize: 1,
    });
    expect(result.receivables.outstanding).toBe('50.00');
    const earlier = (await service.summary(a.tenant, { ...range, asOfDate: '2026-02-28' })).data;
    expect(earlier.collections.rate).toBe('25.0000');
    expect(earlier.collections.sampleSize).toBe(0);
    expect(earlier.receivables.outstanding).toBe('800.00');
  });
  it('excludes draft/cancelled/void claims, retains archived-customer claims, and derives balances independently of caches', async () => {
    await document('2026-01-01', '2026-01-31', '100');
    const cancelled = await document('2026-01-01', '2026-01-31', '100');
    const c = await invoices.issue(a.tenant, cancelled.id, 1);
    await invoices.endLifecycle(a.tenant, c.id, 'CANCELLED', 'Wrong');
    const voided = await document('2026-01-01', '2026-01-31', '100');
    const v = await invoices.issue(a.tenant, voided.id, 1);
    await invoices.endLifecycle(a.tenant, v.id, 'VOID', 'Wrong');
    const source = await prisma.invoice.findUnique({ where: { id: a.invoice.id } });
    await prisma.customer.update({
      where: { id: source.customerId },
      data: { status: 'ARCHIVED' },
    });
    await record(a, '1000', '2026-01-15');
    await prisma.invoice.update({
      where: { id: a.invoice.id },
      data: { amountPaid: '0', balanceDue: '1000' },
    });
    const result = (await service.summary(a.tenant, range)).data;
    expect(result.billing).toEqual({
      totalInvoiced: '1000.00',
      invoiceCounts: { DRAFT: 1, ISSUED: 1, CANCELLED: 1, VOID: 1 },
    });
    expect(result.receivables).toEqual({ outstanding: '0.00', overdue: '0.00' });
    expect(result.collections.averagePaymentDelayDays).toBe('-16.00');
    expect(result.customers.activeCount).toBe(3);
  });
  it('isolates every tenant source and filters exact business dates rather than creation timestamps', async () => {
    await record(a, '0.10', '2026-01-01');
    await record(a, '0.20', '2026-02-28');
    await record(a, '20', '2026-03-01');
    await spend(a, '0.40', '2026-02-28');
    await spend(a, '20', '2026-03-01');
    await record(b, '900', '2026-01-01');
    await spend(b, '500', '2026-02-28');
    const result = (await service.summary(a.tenant, { ...range, asOfDate: '2026-02-28' })).data;
    expect(result.collections.collected).toBe('0.30');
    expect(result.spending.expenses).toBe('0.40');
    expect(result.cash.netCashFlow).toBe('-0.10');
    expect(result.receivables.outstanding).toBe('999.70');
    expect((await service.summary(b.tenant, range)).data.cash.netCashFlow).toBe('400.00');
    expect((await service.aging(b.tenant, { asOfDate: '2026-02-28' })).data.outstanding).toBe(
      '100.00',
    );
  });
  it('places exact due-date boundaries in all five aging buckets, with due today current', async () => {
    await record(a, '1000', '2026-01-01');
    const asOfDate = '2026-06-01';
    for (const days of [0, 1, 30, 31, 60, 61, 90, 91]) {
      const due = new Date(asOfDate + 'T00:00:00Z');
      due.setUTCDate(due.getUTCDate() - days);
      const draft = await document('2026-01-01', due.toISOString().slice(0, 10), '10');
      await invoices.issue(a.tenant, draft.id, 1);
    }
    const aging = (await service.aging(a.tenant, { asOfDate })).data;
    expect(aging.buckets.map((row) => row.invoiceCount)).toEqual([1, 2, 2, 2, 1]);
    expect(aging.buckets.map((row) => row.amount)).toEqual([
      '10.00',
      '20.00',
      '20.00',
      '20.00',
      '10.00',
    ]);
    expect(aging.outstanding).toBe('80.00');
    expect(aging.overdue).toBe('70.00');
    const future = await document('2026-07-01', '2026-07-31', '10');
    await invoices.issue(a.tenant, future.id, 1);
    expect((await service.aging(a.tenant, { asOfDate })).data).toEqual(aging);
  });
  it('returns empty/null metrics and precise aggregates beyond one record limit', async () => {
    const empty = (
      await service.summary(a.tenant, {
        fromDate: '2025-01-01',
        toDate: '2025-01-31',
        asOfDate: '2025-01-31',
      })
    ).data;
    expect(empty.billing.totalInvoiced).toBe('0.00');
    expect(empty.collections.rate).toBeNull();
    expect(empty.receivables.outstanding).toBe('0.00');
    await spend(a, '999999999999999.99', '2026-01-01');
    await spend(a, '999999999999999.99', '2026-01-01');
    expect((await service.summary(a.tenant, range)).data.spending.expenses).toBe(
      '1999999999999999.98',
    );
  });
  it('rejects forged/stale scope and inconsistent selected currency or settlement without leaking raw errors', async () => {
    await expect(service.summary({ ...a.tenant }, range)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await prisma.invoice.update({ where: { id: a.invoice.id }, data: { currency: 'USD' } });
    await expect(service.aging(a.tenant, { asOfDate: range.asOfDate })).rejects.toMatchObject({
      code: 'CURRENCY_MISMATCH',
    });
    await prisma.invoice.update({ where: { id: a.invoice.id }, data: { currency: 'INR' } });
    await prisma.payment.create({
      data: {
        organizationId: a.tenant.organizationId,
        invoiceId: a.invoice.id,
        amount: '1001',
        currency: 'INR',
        paymentDate: new Date('2026-01-01'),
        paymentMethod: 'BANK_TRANSFER',
        createdByUserId: a.tenant.userId,
      },
    });
    await expect(service.summary(a.tenant, range)).rejects.toMatchObject({
      code: 'INVOICE_SETTLEMENT_INCONSISTENT',
    });
    await prisma.membership.update({
      where: { id: a.tenant.membershipId },
      data: { role: 'MEMBER' },
    });
    await expect(service.summary(a.tenant, range)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await prisma.membership.update({
      where: { id: a.tenant.membershipId },
      data: { status: 'SUSPENDED' },
    });
    await expect(service.aging(a.tenant, {})).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
  it('keeps cash and invoice/customer metrics in one snapshot during a committed new payment', async () => {
    const concurrentCash = {
      read: async (...args) => {
        const result = await reader.read(...args);
        await record(a, '500', '2026-01-01');
        return result;
      },
    };
    const snapshot = new AnalyticsService(
      provider,
      authorization,
      new AnalyticsReader(concurrentCash),
    );
    const result = (await snapshot.summary(a.tenant, range)).data;
    expect(result.collections.collected).toBe('0.00');
    expect(result.collections.rate).toBe('0.0000');
    expect(result.receivables.outstanding).toBe('1000.00');
    expect((await service.summary(a.tenant, range)).data.receivables.outstanding).toBe('500.00');
  });
});
