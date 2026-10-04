import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
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
import { clearDatabase, createTestPrismaClient } from './database-test-helpers.js';

describe('payments, reversals, idempotency and PostgreSQL concurrency', () => {
  const prisma = createTestPrismaClient();
  const auth = new AuthorizationService();
  const provider = { getClient: async () => prisma };
  const invoices = new InvoicesService(
    provider,
    auth,
    new CustomerInvoiceReader(),
    new OrganizationInvoiceSettings(),
  );
  const customers = new CustomersService(provider, auth);
  const organizations = new OrganizationsService(provider, auth);
  const service = new PaymentsService(
    provider,
    auth,
    new InvoiceSettlement(),
    new PaymentPersistence(),
    new IdempotencyService(),
  );
  let a;
  let b;
  let invoiceA;
  let invoiceB;
  let customerA;
  const key = () => randomUUID();
  const input = (amount = '25', overrides = {}) => ({
    amount,
    paymentDate: '2026-01-02',
    method: 'BANK_TRANSFER',
    ...overrides,
  });
  const reverseInput = (overrides = {}) => ({
    reason: 'Incorrect receipt',
    reversalDate: '2026-01-03',
    ...overrides,
  });
  const record = (amount = '25', idempotencyKey = key(), tenant = a, invoiceId = invoiceA.id) =>
    service.record(tenant, invoiceId, input(amount), idempotencyKey);
  const reverse = (paymentId, idempotencyKey = key(), tenant = a) =>
    service.reverse(tenant, paymentId, reverseInput(), idempotencyKey);
  const json = (value) => JSON.parse(JSON.stringify(value));

  async function cleanTriggers() {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_payment_audit ON "audit_logs"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_payment_audit()');
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_payment_event ON "pending_events"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_payment_event()');
  }
  async function tenant(name) {
    const email = name + '@example.com';
    const user = await prisma.user.create({
      data: {
        email,
        normalizedEmail: email,
        passwordHash: 'test-only-hash',
        firstName: name,
        lastName: 'Owner',
      },
    });
    const org = await organizations.create(
      { userId: user.id, sessionId: key() },
      { legalName: name, baseCurrency: 'INR', timezone: 'Asia/Kolkata' },
    );
    return (
      await resolveTenantAccess(prisma, { userId: user.id, sessionId: key() }, org.id, auth, [
        PERMISSIONS.PAYMENT_CREATE,
      ])
    ).tenant;
  }
  async function draft(context, customerId, price = '100') {
    return invoices.create(context, {
      customerId,
      issueDate: '2026-01-01',
      dueDate: '2026-01-31',
      discount: { type: 'NONE', value: '0' },
      taxRate: '0',
      items: [{ description: 'Work', quantity: '1', unitPrice: price, sortOrder: 0 }],
    });
  }
  beforeEach(async () => {
    await cleanTriggers();
    await clearDatabase(prisma);
    a = await tenant('payment-a');
    b = await tenant('payment-b');
    customerA = await customers.create(a, { displayName: 'Customer A' });
    const customerB = await customers.create(b, { displayName: 'Customer B' });
    const dA = await draft(a, customerA.id);
    const dB = await draft(b, customerB.id);
    invoiceA = await invoices.issue(a, dA.id, 1);
    invoiceB = await invoices.issue(b, dB.id, 1);
  });
  afterEach(cleanTriggers);
  afterAll(async () => prisma.$disconnect());

  it('records partial/full payments with authoritative sums, preserved documents and version increments', async () => {
    const first = await record('25');
    expect(first).toMatchObject({
      httpStatus: 201,
      replayed: false,
      data: {
        amount: '25.00',
        status: 'RECORDED',
        currency: 'INR',
        method: 'BANK_TRANSFER',
        createdByUserId: a.userId,
        invoice: {
          status: 'ISSUED',
          paymentState: 'PARTIALLY_PAID',
          amountPaid: '25.00',
          balanceDue: '75.00',
          version: 3,
        },
      },
    });
    const second = await record('75');
    expect(second.data.invoice).toMatchObject({
      status: 'ISSUED',
      paymentState: 'PAID',
      amountPaid: '100.00',
      balanceDue: '0.00',
      version: 4,
    });
    const current = await invoices.get(a, invoiceA.id);
    for (const field of [
      'total',
      'subtotal',
      'taxTotal',
      'invoiceNumber',
      'customer',
      'items',
      'issuedAt',
      'issueDate',
      'dueDate',
    ])
      expect(current[field]).toEqual(invoiceA[field]);
    expect((await service.get(a, first.data.id)).invoice.paymentState).toBe('PAID');
    expect((await service.list(a)).data).toHaveLength(2);
  });
  it('persists exact supported precision and reverses full amounts without Number conversion', async () => {
    const tiny = await draft(a, customerA.id, '0.30');
    await invoices.issue(a, tiny.id, 1);
    const first = await record('0.10', key(), a, tiny.id);
    const second = await record('0.20', key(), a, tiny.id);
    expect(second.data.invoice).toMatchObject({
      amountPaid: '0.30',
      balanceDue: '0.00',
      paymentState: 'PAID',
    });
    const persisted = await prisma.payment.findFirst({
      where: { id: first.data.id, organizationId: a.organizationId },
    });
    expect(persisted.amount).toBeInstanceOf(Prisma.Decimal);
    expect(persisted.amount.toFixed(4)).toBe('0.1000');
    const result = await reverse(first.data.id);
    expect(result.data).toMatchObject({
      status: 'REVERSED',
      amount: '0.10',
      reversal: { amount: '0.10', reason: 'Incorrect receipt' },
      invoice: { amountPaid: '0.20', balanceDue: '0.10', paymentState: 'PARTIALLY_PAID' },
    });
    await reverse(second.data.id);
    expect((await invoices.get(a, tiny.id)).paymentState).toBe('UNPAID');
    const maximum = await draft(a, customerA.id, '999999999999999.99');
    await invoices.issue(a, maximum.id, 1);
    expect((await record('999999999999999.99', key(), a, maximum.id)).data.invoice.balanceDue).toBe(
      '0.00',
    );
  });
  it('rejects zero/invalid scale, overpayment and ineligible lifecycle without durable claims', async () => {
    for (const amount of ['0', '0.001', '-1'])
      await expect(record(amount)).rejects.toMatchObject({ code: 'INVALID_PAYMENT_AMOUNT' });
    await expect(record('100.01')).rejects.toMatchObject({ code: 'PAYMENT_EXCEEDS_BALANCE' });
    const d = await draft(a, customerA.id);
    await expect(record('1', key(), a, d.id)).rejects.toMatchObject({
      code: 'INVALID_INVOICE_STATE',
    });
    await invoices.endLifecycle(a, invoiceA.id, 'CANCELLED', 'Wrong customer');
    await expect(record()).rejects.toMatchObject({ code: 'INVALID_INVOICE_STATE' });
    await invoices.endLifecycle(b, invoiceB.id, 'VOID', 'Invalid document');
    await expect(record('1', key(), b, invoiceB.id)).rejects.toMatchObject({
      code: 'INVALID_INVOICE_STATE',
    });
    expect(await prisma.idempotencyRecord.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
  });
  it('conceals foreign/missing invoices and payments and rejects copied contexts', async () => {
    const foreign = await record('10', key(), b, invoiceB.id);
    for (const id of [invoiceB.id, key()])
      await expect(record('1', key(), a, id)).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Invoice not found.',
      });
    for (const id of [foreign.data.id, key()]) {
      await expect(service.get(a, id)).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Payment not found.',
      });
      await expect(reverse(id)).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Payment not found.',
      });
    }
    expect((await service.list(a)).data).toEqual([]);
    expect((await service.list(a, { invoiceId: invoiceB.id })).data).toEqual([]);
    await expect(service.get({ ...a }, foreign.data.id)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });
  it('database composite FKs reject foreign Invoice and Payment references', async () => {
    await expect(
      prisma.payment.create({
        data: {
          organizationId: a.organizationId,
          invoiceId: invoiceB.id,
          amount: '1',
          currency: 'INR',
          paymentDate: new Date('2026-01-01'),
          paymentMethod: 'CASH',
          createdByUserId: a.userId,
        },
      }),
    ).rejects.toThrow();
    const payment = await record();
    await expect(
      prisma.paymentReversal.create({
        data: {
          organizationId: b.organizationId,
          paymentId: payment.data.id,
          amount: '25',
          reason: 'Bad reference',
          reversalDate: new Date('2026-01-01'),
          reversedByUserId: b.userId,
        },
      }),
    ).rejects.toThrow();
  });
  it('replays original creation/reversal receipts exactly after later settlement and terminal lifecycle changes', async () => {
    const createKey = key();
    const reverseKey = key();
    const original = await record('25', createKey);
    expect(json((await record('25.00', createKey)).data)).toEqual(json(original.data));
    const second = await record('25');
    const reversed = await reverse(original.data.id, reverseKey);
    const third = await record('25');
    expect(json((await record('25', createKey)).data)).toEqual(json(original.data));
    expect(json((await reverse(original.data.id, reverseKey)).data)).toEqual(json(reversed.data));
    await reverse(second.data.id);
    await reverse(third.data.id);
    await invoices.endLifecycle(a, invoiceA.id, 'VOID', 'Replaced document');
    expect(json((await record('25', createKey)).data)).toEqual(json(original.data));
    expect(json((await reverse(original.data.id, reverseKey)).data)).toEqual(json(reversed.data));
    expect((await service.get(a, original.data.id)).status).toBe('REVERSED');
    expect(await prisma.payment.count()).toBe(3);
    expect(await prisma.auditLog.count({ where: { action: 'PAYMENT_RECORDED' } })).toBe(3);
    expect(await prisma.pendingEvent.count({ where: { eventType: 'PAYMENT_RECORDED' } })).toBe(3);
  });
  it('rejects same-key changed amount/method/date/resource/reversal reason', async () => {
    const createKey = key();
    const original = await record('10', createKey);
    for (const override of [{ amount: '11' }, { method: 'UPI' }, { paymentDate: '2026-01-04' }])
      await expect(
        service.record(a, invoiceA.id, input('10', override), createKey),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const d = await draft(a, customerA.id);
    await invoices.issue(a, d.id, 1);
    await expect(record('10', createKey, a, d.id)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    const reverseKey = key();
    await reverse(original.data.id, reverseKey);
    await expect(
      service.reverse(a, original.data.id, reverseInput({ reason: 'Different' }), reverseKey),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await prisma.payment.count()).toBe(1);
  });
  it('scopes identical keys independently by tenant, user and operation', async () => {
    const shared = key();
    const pa = await record('10', shared);
    await record('10', shared, b, invoiceB.id);
    const user = await prisma.user.create({
      data: {
        email: 'accountant@example.com',
        normalizedEmail: 'accountant@example.com',
        passwordHash: 'test-only',
        firstName: 'Accountant',
        lastName: 'User',
      },
    });
    await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: a.organizationId,
        role: 'ACCOUNTANT',
        status: 'ACTIVE',
      },
    });
    const other = (
      await resolveTenantAccess(
        prisma,
        { userId: user.id, sessionId: key() },
        a.organizationId,
        auth,
        [PERMISSIONS.PAYMENT_CREATE],
      )
    ).tenant;
    await record('10', shared, other);
    await reverse(pa.data.id, shared);
    expect(await prisma.idempotencyRecord.count()).toBe(4);
  });
  it('applies simultaneous same-key requests exactly once with one audit/event/version increment', async () => {
    const shared = key();
    const results = await Promise.all(Array.from({ length: 6 }, () => record('25', shared)));
    expect(new Set(results.map((r) => r.data.id)).size).toBe(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(5);
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.idempotencyRecord.count()).toBe(1);
    expect((await invoices.get(a, invoiceA.id)).version).toBe(3);
    expect(await prisma.auditLog.count({ where: { action: 'PAYMENT_RECORDED' } })).toBe(1);
    expect(await prisma.pendingEvent.count({ where: { eventType: 'PAYMENT_RECORDED' } })).toBe(1);
  });
  it('serializes simultaneous overpaying requests and releases the failed claim for safe retry', async () => {
    const keys = [key(), key()];
    const results = await Promise.allSettled(keys.map((k) => record('80', k)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.findIndex((r) => r.status === 'rejected');
    expect(results[loser].reason).toMatchObject({
      code: 'PAYMENT_EXCEEDS_BALANCE',
      details: { currency: 'INR', remainingBalance: '20.00' },
    });
    expect((await invoices.get(a, invoiceA.id)).amountPaid).toBe('80.00');
    expect(await prisma.idempotencyRecord.count()).toBe(1);
    expect((await record('20', keys[loser])).data.invoice.paymentState).toBe('PAID');
  });
  it('allows exactly one concurrent reversal with different keys and replays same-key reversal races', async () => {
    const payment = await record('40');
    const results = await Promise.allSettled([reverse(payment.data.id), reverse(payment.data.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.code).toBe(
      'PAYMENT_ALREADY_REVERSED',
    );
    expect(await prisma.paymentReversal.count()).toBe(1);
    expect((await invoices.get(a, invoiceA.id)).balanceDue).toBe('100.00');
    const second = await record('20');
    const shared = key();
    const replays = await Promise.all([
      reverse(second.data.id, shared),
      reverse(second.data.id, shared),
    ]);
    expect(replays.filter((r) => r.replayed)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: 'PAYMENT_REVERSED' } })).toBe(2);
  });
  it('serializes payment against reversal on the same Invoice and keeps caches equal to the active sum', async () => {
    const initial = await record('80');
    const results = await Promise.allSettled([record('80'), reverse(initial.data.id)]);
    expect(results[1].status).toBe('fulfilled');
    const sum = await prisma.payment.aggregate({
      where: { organizationId: a.organizationId, invoiceId: invoiceA.id, status: 'RECORDED' },
      _sum: { amount: true },
    });
    const current = await invoices.get(a, invoiceA.id);
    const paid = sum._sum.amount ?? new Prisma.Decimal('0');
    expect(paid.lte('100')).toBe(true);
    expect(current.amountPaid).toBe(paid.toFixed(2));
    expect(current.balanceDue).toBe(new Prisma.Decimal('100').sub(paid).toFixed(2));
  });
  it('uses the same Invoice lock for payment and void, preventing invalid terminal settlement', async () => {
    const results = await Promise.allSettled([
      record('20'),
      invoices.endLifecycle(a, invoiceA.id, 'VOID', 'Invalid'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const current = await invoices.get(a, invoiceA.id);
    if (current.status === 'VOID') {
      expect(current.amountPaid).toBe('0.00');
      expect(await prisma.payment.count()).toBe(0);
    } else {
      expect(current.amountPaid).toBe('20.00');
      expect(results[1].reason.code).toBe('ACTIVE_PAYMENTS_EXIST');
    }
  });
  it('rolls back payments, reversals, invoice caches, audits/events and claims on mandatory audit failure', async () => {
    const existing = await record('40');
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION test_fail_payment_audit() RETURNS trigger AS $$ BEGIN IF NEW."entityType" = 'Payment' THEN RAISE EXCEPTION 'forced payment audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER test_fail_payment_audit BEFORE INSERT ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION test_fail_payment_audit()',
    );
    await expect(record('10')).rejects.toThrow();
    await expect(reverse(existing.data.id)).rejects.toThrow();
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.paymentReversal.count()).toBe(0);
    expect((await service.get(a, existing.data.id)).status).toBe('RECORDED');
    expect(await invoices.get(a, invoiceA.id)).toMatchObject({
      amountPaid: '40.00',
      balanceDue: '60.00',
      version: 3,
    });
    expect(await prisma.idempotencyRecord.count()).toBe(1);
    expect(await prisma.pendingEvent.count({ where: { aggregateType: 'Payment' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: 'Payment' } })).toBe(1);
  });
  it('rolls back the preceding audit and settlement when PendingEvent insertion fails', async () => {
    const existing = await record('40');
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION test_fail_payment_event() RETURNS trigger AS $$ BEGIN IF NEW."aggregateType" = 'Payment' THEN RAISE EXCEPTION 'forced payment event failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER test_fail_payment_event BEFORE INSERT ON "pending_events" FOR EACH ROW EXECUTE FUNCTION test_fail_payment_event()',
    );
    await expect(record('10')).rejects.toThrow();
    await expect(reverse(existing.data.id)).rejects.toThrow();
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.paymentReversal.count()).toBe(0);
    expect(await invoices.get(a, invoiceA.id)).toMatchObject({
      amountPaid: '40.00',
      balanceDue: '60.00',
      version: 3,
    });
    expect(await prisma.idempotencyRecord.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: 'Payment' } })).toBe(1);
  });
  it('rejects settlement cache drift without repairing or applying financial mutations', async () => {
    await prisma.invoice.update({
      where: { id: invoiceA.id },
      data: { amountPaid: '1', balanceDue: '99' },
    });
    await expect(record()).rejects.toMatchObject({ code: 'INVOICE_SETTLEMENT_INCONSISTENT' });
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.idempotencyRecord.count()).toBe(0);
  });
  it('paginates all documented sorts, filters and directions with tied keys and tenant-bound cursors', async () => {
    for (const amount of ['10', '10', '20', '30']) await record(amount);
    for (const sortBy of ['amount', 'paymentDate', 'recordedAt'])
      for (const sortOrder of ['asc', 'desc']) {
        const seen = [];
        let after;
        do {
          const page = await service.list(a, {
            sortBy,
            sortOrder,
            limit: '2',
            ...(after ? { after } : {}),
          });
          seen.push(...page.data.map((row) => row.id));
          after = page.meta.nextCursor;
        } while (after);
        const expected = await prisma.payment.findMany({
          where: { organizationId: a.organizationId },
          orderBy: [{ [sortBy]: sortOrder }, { id: sortOrder }],
        });
        expect(seen).toEqual(expected.map((row) => row.id));
      }
    const first = await service.list(a, { limit: '1' });
    await expect(service.list(b, { after: first.meta.nextCursor })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
    await expect(
      service.list(a, { after: first.meta.nextCursor, method: 'CASH' }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(
      (
        await service.list(a, {
          invoiceId: invoiceA.id,
          status: 'RECORDED',
          method: 'BANK_TRANSFER',
          paymentDateFrom: '2026-01-02',
          paymentDateTo: '2026-01-02',
        })
      ).data,
    ).toHaveLength(4);
  });
  it('reauthorizes both fresh mutations and key replay against current membership', async () => {
    const shared = key();
    const payment = await record('20', shared);
    await prisma.membership.update({ where: { id: a.membershipId }, data: { role: 'MEMBER' } });
    await expect(record('20', shared)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(reverse(payment.data.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.get(a, payment.data.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await prisma.membership.update({ where: { id: a.membershipId }, data: { status: 'REMOVED' } });
    await expect(service.list(a)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
