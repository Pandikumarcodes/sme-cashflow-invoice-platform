import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AuthorizationService } from '../../src/common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../src/common/authorization/permissions.js';
import { resolveTenantAccess } from '../../src/common/tenancy/tenant-context.js';
import { InvoicesService } from '../../src/modules/invoices/application/invoices.service.js';
import { CustomersService } from '../../src/modules/customers/application/customers.service.js';
import { CustomerInvoiceReader } from '../../src/modules/customers/application/customer-invoice-reader.js';
import { OrganizationInvoiceSettings } from '../../src/modules/organizations/application/organization-invoice-settings.js';
import { OrganizationsService } from '../../src/modules/organizations/application/organizations.service.js';
import { clearDatabase, createTestPrismaClient } from './database-test-helpers.js';

describe('invoice persistence, locking and tenant isolation', () => {
  const prisma = createTestPrismaClient();
  const authorization = new AuthorizationService();
  const provider = { getClient: async () => prisma };
  const service = new InvoicesService(
    provider,
    authorization,
    new CustomerInvoiceReader(),
    new OrganizationInvoiceSettings(),
  );
  const customers = new CustomersService(provider, authorization);
  const organizations = new OrganizationsService(provider, authorization);
  let a;
  let b;
  let customerA;
  let customerB;
  const input = (customerId, overrides = {}) => ({
    customerId,
    issueDate: '2026-01-01',
    dueDate: '2026-01-31',
    discount: { type: 'PERCENTAGE', value: '10' },
    taxRate: '18',
    items: [{ description: 'Work', quantity: '3', unitPrice: '33.335', sortOrder: 0 }],
    ...overrides,
  });
  const draft = (tenant = a, overrides = {}) =>
    service.create(tenant, input(tenant === a ? customerA.id : customerB.id, overrides));
  async function cleanup() {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_invoice_audit ON "audit_logs"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_invoice_audit()');
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_invoice_item ON "invoice_items"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_invoice_item()');
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
      { userId: user.id, sessionId: randomUUID() },
      { legalName: name, baseCurrency: 'INR', timezone: 'Asia/Kolkata' },
    );
    return (
      await resolveTenantAccess(
        prisma,
        { userId: user.id, sessionId: randomUUID() },
        org.id,
        authorization,
        [PERMISSIONS.INVOICE_CREATE],
      )
    ).tenant;
  }
  beforeEach(async () => {
    await cleanup();
    await clearDatabase(prisma);
    a = await tenant('invoice-a');
    b = await tenant('invoice-b');
    customerA = await customers.create(a, { displayName: 'A %_ customer', email: 'a@example.com' });
    customerB = await customers.create(b, { displayName: 'B customer' });
  });
  afterEach(cleanup);
  afterAll(async () => prisma.$disconnect());

  it('persists exact Decimal totals, server tenant/currency, items, currency lock and audit atomically', async () => {
    const row = await draft(a, { organizationId: b.organizationId, total: '1', status: 'ISSUED' });
    expect(row).toMatchObject({
      organizationId: a.organizationId,
      currency: 'INR',
      status: 'DRAFT',
      invoiceNumber: null,
      total: '106.21',
      version: 1,
    });
    const stored = await prisma.invoice.findFirst({
      where: { id: row.id, organizationId: a.organizationId },
    });
    expect(stored.total).toBeInstanceOf(Prisma.Decimal);
    expect(stored.total.toFixed(4)).toBe('106.2100');
    expect(row.items[0]).toMatchObject({
      quantity: '3',
      unitPrice: '33.3350',
      lineAmount: '100.01',
    });
    const org = await prisma.organization.findUnique({ where: { id: a.organizationId } });
    expect(org.currencyLockedAt).toBeInstanceOf(Date);
    await expect(
      organizations.update(a, a.organizationId, org.version, { baseCurrency: 'USD' }),
    ).rejects.toMatchObject({ code: 'CURRENCY_LOCKED' });
    expect(await prisma.auditLog.findFirst({ where: { entityId: row.id } })).toMatchObject({
      action: 'INVOICE_CREATED',
      actorMembershipId: a.membershipId,
      actorSessionId: a.sessionId,
    });
  });
  it('conceals foreign/missing customers and all foreign/missing invoice operations identically', async () => {
    for (const id of [customerB.id, randomUUID()])
      await expect(draft(a, { customerId: id })).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Customer not found.',
      });
    const foreign = await draft(b);
    for (const id of [foreign.id, randomUUID()])
      for (const call of [
        () => service.get(a, id),
        () => service.update(a, id, 1, { taxRate: '0' }),
        () => service.issue(a, id, 1),
        () => service.deleteDraft(a, id, 1),
        () => service.endLifecycle(a, id, 'CANCELLED', 'Mistake'),
        () => service.endLifecycle(a, id, 'VOID', 'Mistake'),
      ])
        await expect(call()).rejects.toMatchObject({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Invoice not found.',
        });
    expect((await service.list(a)).data).toEqual([]);
    await expect(service.get({ ...a }, foreign.id)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });
  it('database composite FKs reject foreign Customer and InvoiceItem relationships', async () => {
    const row = await draft();
    await expect(
      prisma.invoice.create({
        data: {
          organizationId: a.organizationId,
          customerId: customerB.id,
          createdByUserId: a.userId,
          currency: 'INR',
          issueDate: new Date('2026-01-01'),
          dueDate: new Date('2026-01-31'),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.invoiceItem.create({
        data: {
          organizationId: b.organizationId,
          invoiceId: row.id,
          description: 'Bad reference',
          quantity: '1',
          unitPrice: '1',
          lineAmount: '1',
          sortOrder: 9,
        },
      }),
    ).rejects.toThrow();
  });
  it('recalculates complete draft replacement and serializes versioned edits', async () => {
    const row = await draft();
    const replacement = input(customerA.id, {
      items: [{ description: 'New', quantity: '2', unitPrice: '10', sortOrder: 0 }],
    });
    const race = await Promise.allSettled([
      service.update(a, row.id, 1, replacement),
      service.update(a, row.id, 1, { taxRate: '0' }),
    ]);
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(race.find((r) => r.status === 'rejected').reason.code).toBe('CONCURRENT_MODIFICATION');
    const current = await service.get(a, row.id);
    const updated = await service.update(a, row.id, current.version, replacement);
    expect(updated).toMatchObject({
      total: '21.24',
      items: [expect.objectContaining({ description: 'New', lineAmount: '20.00' })],
    });
    expect(await prisma.invoiceItem.count({ where: { invoiceId: row.id } })).toBe(1);
  });
  it('issues with recomputation, immutable snapshot, version, one audit/event and retained number', async () => {
    const row = await draft();
    // A valid row CHECK alone cannot ensure cached results follow item inputs.
    // Issue must repair these deliberately corrupted test-only draft caches.
    await prisma.invoice.update({
      where: { id: row.id },
      data: {
        subtotal: '1',
        discountTotal: '0',
        taxableTotal: '1',
        taxTotal: '0',
        total: '1',
        balanceDue: '1',
      },
    });
    await prisma.invoiceItem.updateMany({
      where: { invoiceId: row.id, organizationId: a.organizationId },
      data: { lineAmount: '1' },
    });
    const issued = await service.issue(a, row.id, 1, { requestId: 'issue-test' });
    expect(issued.items[0].lineAmount).toBe('100.01');
    expect(issued).toMatchObject({
      status: 'ISSUED',
      invoiceNumber: 'INV-000001',
      sequenceValue: '1',
      total: '106.21',
      version: 2,
      issuedByUserId: a.userId,
      customer: { displayName: customerA.displayName },
    });
    await customers.update(a, customerA.id, 1, { displayName: 'Changed', email: null });
    await customers.archive(a, customerA.id);
    expect((await service.get(a, row.id)).customer).toEqual(issued.customer);
    expect((await service.list(a, { search: '%_' })).data.map((r) => r.id)).toEqual([row.id]);
    for (const call of [
      () => service.update(a, row.id, 2, { taxRate: '0' }),
      () => service.deleteDraft(a, row.id, 2),
    ])
      await expect(call()).rejects.toMatchObject({ code: 'INVOICE_FINALIZED' });
    await expect(service.issue(a, row.id, 2)).rejects.toMatchObject({
      code: 'INVALID_INVOICE_STATE',
    });
    expect(
      await prisma.auditLog.count({ where: { entityId: row.id, action: 'INVOICE_ISSUED' } }),
    ).toBe(1);
    const event = await prisma.pendingEvent.findFirst({ where: { aggregateId: row.id } });
    expect(event.payload).toMatchObject({
      version: 1,
      invoiceId: row.id,
      organizationId: a.organizationId,
      requestId: 'issue-test',
    });
    expect(event.payload.total).toBeUndefined();
  });
  it('rejects zero totals, stale issue, archived customer and invalid dates without allocating a number', async () => {
    const row = await draft(a, {
      discount: { type: 'NONE', value: '0' },
      taxRate: '0',
      items: [{ description: 'Free', quantity: '1', unitPrice: '0', sortOrder: 0 }],
    });
    await expect(service.issue(a, row.id, 1)).rejects.toMatchObject({ code: 'INVALID_MONEY' });
    await expect(service.issue(a, row.id, 9)).rejects.toMatchObject({
      code: 'CONCURRENT_MODIFICATION',
    });
    await expect(draft(a, { dueDate: '2025-12-31' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await customers.archive(a, customerA.id);
    await expect(draft()).rejects.toMatchObject({ code: 'INVALID_INVOICE_STATE' });
    await expect(service.issue(a, row.id, 1)).rejects.toMatchObject({
      code: 'INVALID_INVOICE_STATE',
    });
    expect(
      (await prisma.invoiceSequence.findUnique({ where: { organizationId: a.organizationId } }))
        .nextValue,
    ).toBe(1n);
  });
  it('allocates unique consecutive numbers under concurrency and independent tenant sequences', async () => {
    const drafts = [];
    for (let i = 0; i < 6; i++) drafts.push(await draft());
    const issued = await Promise.all(drafts.map((row) => service.issue(a, row.id, 1)));
    expect(issued.map((row) => row.sequenceValue).sort()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(new Set(issued.map((row) => row.invoiceNumber)).size).toBe(6);
    expect(
      (await prisma.invoiceSequence.findUnique({ where: { organizationId: a.organizationId } }))
        .nextValue,
    ).toBe(7n);
    const other = await draft(b);
    expect((await service.issue(b, other.id, 1)).invoiceNumber).toBe('INV-000001');
    const same = await draft();
    const race = await Promise.allSettled([
      service.issue(a, same.id, 1),
      service.issue(a, same.id, 1),
    ]);
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await prisma.invoiceSequence.findUnique({ where: { organizationId: a.organizationId } }))
        .nextValue,
    ).toBe(8n);
  });
  it('retains prefix snapshots and uses the current prefix/padding only for future allocations', async () => {
    const first = await draft();
    await service.issue(a, first.id, 1);
    const org = await prisma.organization.findUnique({ where: { id: a.organizationId } });
    await organizations.update(a, a.organizationId, org.version, {
      invoicePrefix: 'BILL-',
      invoiceNumberPadding: 3,
    });
    const second = await draft();
    expect((await service.issue(a, second.id, 1)).invoiceNumber).toBe('BILL-002');
    expect((await service.get(a, first.id)).invoiceNumber).toBe('INV-000001');
  });
  it('rolls back header, items, currency lock and audit when item insertion fails', async () => {
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION test_fail_invoice_item() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced item failure'; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER test_fail_invoice_item BEFORE INSERT ON "invoice_items" FOR EACH ROW EXECUTE FUNCTION test_fail_invoice_item()',
    );
    await expect(draft()).rejects.toThrow();
    expect(await prisma.invoice.count()).toBe(0);
    expect(await prisma.invoiceItem.count()).toBe(0);
    expect(
      (await prisma.organization.findUnique({ where: { id: a.organizationId } })).currencyLockedAt,
    ).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityType: 'Invoice' } })).toBe(0);
  });
  it('rolls back draft replacement, issue counter/event and deletion when audit fails', async () => {
    const row = await draft();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION test_fail_invoice_audit() RETURNS trigger AS $$ BEGIN IF NEW."entityType" = 'Invoice' THEN RAISE EXCEPTION 'forced invoice audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER test_fail_invoice_audit BEFORE INSERT ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION test_fail_invoice_audit()',
    );
    await expect(
      service.update(a, row.id, 1, {
        items: [{ description: 'Rollback', quantity: '1', unitPrice: '1', sortOrder: 0 }],
      }),
    ).rejects.toThrow();
    await expect(service.issue(a, row.id, 1)).rejects.toThrow();
    await expect(service.deleteDraft(a, row.id, 1)).rejects.toThrow();
    expect(await service.get(a, row.id)).toMatchObject({
      status: 'DRAFT',
      version: 1,
      total: '106.21',
      items: [expect.objectContaining({ description: 'Work' })],
    });
    expect(
      (await prisma.invoiceSequence.findUnique({ where: { organizationId: a.organizationId } }))
        .nextValue,
    ).toBe(1n);
    expect(await prisma.pendingEvent.count()).toBe(0);
  });
  it('audits draft deletion and preserves the permanent currency lock', async () => {
    const row = await draft();
    await expect(service.deleteDraft(a, row.id, 9)).rejects.toMatchObject({
      code: 'CONCURRENT_MODIFICATION',
    });
    await service.deleteDraft(a, row.id, 1);
    expect(await prisma.invoice.count()).toBe(0);
    expect(await prisma.invoiceItem.count()).toBe(0);
    expect(
      await prisma.auditLog.findFirst({ where: { entityId: row.id, action: 'INVOICE_DELETED' } }),
    ).toBeTruthy();
    expect(
      (await prisma.organization.findUnique({ where: { id: a.organizationId } })).currencyLockedAt,
    ).not.toBeNull();
  });
  it('distinguishes cancellation payment history from void active payments and retains lifecycle evidence', async () => {
    const cancel = await draft();
    await service.issue(a, cancel.id, 1);
    expect(await service.endLifecycle(a, cancel.id, 'CANCELLED', 'Wrong customer')).toMatchObject({
      status: 'CANCELLED',
      invoiceNumber: 'INV-000001',
      cancelReason: 'Wrong customer',
      paymentState: 'NOT_APPLICABLE',
      isOverdue: false,
    });
    const row = await draft();
    await service.issue(a, row.id, 1);
    const payment = await prisma.payment.create({
      data: {
        organizationId: a.organizationId,
        invoiceId: row.id,
        amount: '1',
        currency: 'INR',
        paymentDate: new Date('2026-01-01'),
        paymentMethod: 'CASH',
        createdByUserId: a.userId,
      },
    });
    for (const status of ['CANCELLED', 'VOID'])
      await expect(service.endLifecycle(a, row.id, status, 'Invalid')).rejects.toMatchObject({
        code: 'ACTIVE_PAYMENTS_EXIST',
      });
    // Synthetic reversed history tests lifecycle preconditions only; no public payment writer.
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'REVERSED', reversedAt: new Date() },
    });
    await expect(service.endLifecycle(a, row.id, 'CANCELLED', 'Invalid')).rejects.toMatchObject({
      code: 'ACTIVE_PAYMENTS_EXIST',
    });
    expect(await service.endLifecycle(a, row.id, 'VOID', 'Invalid document')).toMatchObject({
      status: 'VOID',
      voidReason: 'Invalid document',
      balanceDue: '106.21',
    });
    await expect(service.endLifecycle(a, row.id, 'VOID', 'Repeat')).rejects.toMatchObject({
      code: 'INVALID_INVOICE_STATE',
    });
  });
  it('paginates every documented sort both ways including null numbers, binds cursors and filters safely', async () => {
    const rows = [];
    for (let i = 0; i < 5; i++) rows.push(await draft(a, { issueDate: '2026-01-0' + (i + 1) }));
    await service.issue(a, rows[0].id, 1);
    await service.issue(a, rows[1].id, 1);
    for (const sortBy of ['issueDate', 'dueDate', 'createdAt', 'total', 'invoiceNumber'])
      for (const sortOrder of ['asc', 'desc']) {
        const ids = [];
        let after;
        do {
          const page = await service.list(a, {
            sortBy,
            sortOrder,
            limit: '2',
            ...(after ? { after } : {}),
          });
          ids.push(...page.data.map((row) => row.id));
          after = page.meta.nextCursor;
        } while (after);
        const expected = await prisma.invoice.findMany({
          where: { organizationId: a.organizationId },
          orderBy: [
            {
              [sortBy]: sortBy === 'invoiceNumber' ? { sort: sortOrder, nulls: 'last' } : sortOrder,
            },
            { id: sortOrder },
          ],
        });
        expect(ids).toEqual(expected.map((row) => row.id));
      }
    const first = await service.list(a, { limit: '1' });
    await expect(service.list(b, { after: first.meta.nextCursor })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
    await expect(
      service.list(a, { after: first.meta.nextCursor, status: 'ISSUED' }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect((await service.list(a, { search: '%_' })).data).toHaveLength(5);
    expect((await service.list(a, { paymentState: 'UNPAID', overdue: 'true' })).data).toHaveLength(
      2,
    );
    expect(
      (await service.list(a, { issueDateFrom: '2026-01-03', issueDateTo: '2026-01-04' })).data,
    ).toHaveLength(2);
    expect((await service.list(a, { customerId: customerB.id })).data).toHaveLength(0);
  });
  it('rechecks membership permission and status before financial operations', async () => {
    const row = await draft();
    await prisma.membership.update({ where: { id: a.membershipId }, data: { role: 'VIEWER' } });
    await expect(service.get(a, row.id)).resolves.toBeDefined();
    await expect(service.issue(a, row.id, 1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await prisma.membership.update({
      where: { id: a.membershipId },
      data: { status: 'SUSPENDED' },
    });
    await expect(service.get(a, row.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('serializes first-draft currency locking against organization currency changes', async () => {
    const results = await Promise.allSettled([
      draft(),
      organizations.update(a, a.organizationId, 1, { baseCurrency: 'USD' }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    const org = await prisma.organization.findUnique({ where: { id: a.organizationId } });
    expect(org.currencyLockedAt).toBeInstanceOf(Date);
    expect(results[0].value.currency).toBe(org.baseCurrency);
    if (results[1].status === 'rejected') expect(results[1].reason.code).toBe('CURRENCY_LOCKED');
  });

  it('database evidence CHECKs reject incomplete finalized documents and issuer FKs', async () => {
    const row = await draft();
    const finalization = {
      status: 'ISSUED',
      invoiceNumber: 'INV-000001',
      sequenceValue: 1n,
      numberPrefix: 'INV-',
      issuedAt: new Date(),
    };
    await expect(
      prisma.invoice.update({ where: { id: row.id }, data: finalization }),
    ).rejects.toThrow();
    await expect(
      prisma.invoice.update({
        where: { id: row.id },
        data: { ...finalization, issuedByUserId: randomUUID(), billToName: 'Snapshot' },
      }),
    ).rejects.toThrow();
    await service.issue(a, row.id, 1);
    await expect(
      prisma.invoice.update({ where: { id: row.id }, data: { status: 'CANCELLED' } }),
    ).rejects.toThrow();
    await expect(
      prisma.invoice.update({ where: { id: row.id }, data: { status: 'VOID', voidReason: ' ' } }),
    ).rejects.toThrow();
    expect((await service.get(a, row.id)).status).toBe('ISSUED');
  });
});
