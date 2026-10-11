import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { clearDatabase, createTestPrismaClient } from './database-test-helpers.js';

const decimal = (value) => new Prisma.Decimal(value);
let prisma;

function unique(prefix) {
  return `${prefix}-${randomUUID()}`;
}

async function createOrganization() {
  return prisma.organization.create({
    data: {
      legalName: unique('Legal'),
      displayName: unique('Display'),
      baseCurrency: 'INR',
      timezone: 'Asia/Kolkata',
    },
  });
}

async function createUser() {
  const email = `${randomUUID()}@example.test`;
  return prisma.user.create({
    data: {
      email,
      normalizedEmail: email,
      passwordHash: 'not-a-real-password-hash',
      firstName: 'Test',
      lastName: 'User',
    },
  });
}

async function createCustomer(organizationId, createdByUserId) {
  return prisma.customer.create({
    data: {
      organizationId,
      displayName: unique('Customer'),
      createdByUserId,
    },
  });
}

async function createInvoice(organizationId, customerId, createdByUserId, overrides = {}) {
  return prisma.invoice.create({
    data: {
      organizationId,
      customerId,
      createdByUserId,
      issueDate: new Date('2026-01-01T00:00:00.000Z'),
      dueDate: new Date('2026-01-31T00:00:00.000Z'),
      currency: 'INR',
      ...overrides,
    },
  });
}

async function createPayment(organizationId, invoiceId, createdByUserId, overrides = {}) {
  return prisma.payment.create({
    data: {
      organizationId,
      invoiceId,
      createdByUserId,
      amount: decimal('0.1000'),
      currency: 'INR',
      paymentDate: new Date('2026-01-02T00:00:00.000Z'),
      paymentMethod: 'CASH',
      ...overrides,
    },
  });
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await prisma.$connect();
});

beforeEach(async () => {
  await clearDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('initial PostgreSQL schema', () => {
  test('has the approved PostgreSQL numeric types, composite FKs, and partial indexes', async () => {
    const columns = await prisma.$queryRawUnsafe(`
      SELECT table_name, column_name, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type = 'numeric'
      ORDER BY table_name, column_name
    `);
    const columnScales = new Map(
      columns.map((column) => [
        `${column.table_name}.${column.column_name}`,
        `${column.numeric_precision},${column.numeric_scale}`,
      ]),
    );
    expect(columnScales.get('invoices.discountValue')).toBe('19,6');
    expect(columnScales.get('invoices.taxRate')).toBe('9,6');
    expect(columnScales.get('invoice_items.quantity')).toBe('19,6');
    for (const name of [
      'invoices.subtotal',
      'invoices.total',
      'invoice_items.unitPrice',
      'invoice_items.lineAmount',
      'payments.amount',
      'payment_reversals.amount',
      'expenses.amount',
    ]) {
      expect(columnScales.get(name)).toBe('19,4');
    }

    const constraints = await prisma.$queryRawUnsafe(`
      SELECT conname
      FROM pg_constraint
      WHERE conname IN (
        'invoices_organizationId_customerId_fkey',
        'invoice_items_organizationId_invoiceId_fkey',
        'payments_organizationId_invoiceId_fkey',
        'payment_reversals_organizationId_paymentId_fkey',
        'expenses_organizationId_expenseCategoryId_fkey',
        'reminder_deliveries_organizationId_invoiceId_fkey',
        'invoices_financial_and_lifecycle_check'
      )
    `);
    expect(constraints).toHaveLength(7);

    const indexes = await prisma.$queryRawUnsafe(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'memberships_one_active_owner_per_organization_key',
          'organization_invitations_pending_email_per_organization_key',
          'invoices_issued_number_per_organization_key',
          'notifications_deduplication_per_recipient_key'
        )
    `);
    expect(indexes).toHaveLength(4);
    expect(indexes.every((index) => index.indexdef.includes('WHERE'))).toBe(true);
  });

  test('enforces membership uniqueness and invoice number scope', async () => {
    const [user, organizationA, organizationB] = await Promise.all([
      createUser(),
      createOrganization(),
      createOrganization(),
    ]);
    await prisma.membership.create({
      data: { userId: user.id, organizationId: organizationA.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await expect(
      prisma.membership.create({
        data: { userId: user.id, organizationId: organizationA.id, role: 'MEMBER' },
      }),
    ).rejects.toThrow();

    const customerA = await createCustomer(organizationA.id, user.id);
    const customerB = await createCustomer(organizationB.id, user.id);
    const issued = {
      status: 'ISSUED',
      issuedByUserId: user.id,
      billToName: 'Snapshot customer',
      invoiceNumber: 'INV-000001',
      sequenceValue: BigInt(1),
      numberPrefix: 'INV-',
      issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      subtotal: decimal('0.3000'),
      taxableTotal: decimal('0.3000'),
      total: decimal('0.3000'),
      balanceDue: decimal('0.3000'),
    };
    await createInvoice(organizationA.id, customerA.id, user.id, issued);
    await expect(createInvoice(organizationA.id, customerA.id, user.id, issued)).rejects.toThrow();
    await expect(
      createInvoice(organizationB.id, customerB.id, user.id, issued),
    ).resolves.toBeDefined();
  });

  test('rejects every tested cross-tenant composite relationship', async () => {
    const user = await createUser();
    const [organizationA, organizationB] = await Promise.all([
      createOrganization(),
      createOrganization(),
    ]);
    const customerA = await createCustomer(organizationA.id, user.id);
    const customerB = await createCustomer(organizationB.id, user.id);
    const invoiceA = await createInvoice(organizationA.id, customerA.id, user.id);
    const invoiceB = await createInvoice(organizationB.id, customerB.id, user.id);

    await expect(createInvoice(organizationA.id, customerB.id, user.id)).rejects.toThrow();
    await expect(createPayment(organizationA.id, invoiceB.id, user.id)).rejects.toThrow();
    await expect(
      prisma.invoiceItem.create({
        data: {
          organizationId: organizationA.id,
          invoiceId: invoiceB.id,
          description: 'Mismatch',
          quantity: decimal('1.000000'),
          unitPrice: decimal('1.0000'),
          lineAmount: decimal('1.0000'),
          sortOrder: 0,
        },
      }),
    ).rejects.toThrow();

    const paymentB = await createPayment(organizationB.id, invoiceB.id, user.id);
    await expect(
      prisma.paymentReversal.create({
        data: {
          organizationId: organizationA.id,
          paymentId: paymentB.id,
          amount: decimal('0.1000'),
          reason: 'Mismatch',
          reversalDate: new Date('2026-01-03T00:00:00.000Z'),
          reversedByUserId: user.id,
        },
      }),
    ).rejects.toThrow();

    const categoryB = await prisma.expenseCategory.create({
      data: { organizationId: organizationB.id, name: 'Travel', normalizedName: 'travel' },
    });
    await expect(
      prisma.expense.create({
        data: {
          organizationId: organizationA.id,
          expenseCategoryId: categoryB.id,
          amount: decimal('1.0000'),
          currency: 'INR',
          expenseDate: new Date('2026-01-01T00:00:00.000Z'),
          description: 'Mismatch',
          createdByUserId: user.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.reminderDelivery.create({
        data: {
          organizationId: organizationA.id,
          invoiceId: invoiceB.id,
          reminderType: 'DUE_SOON',
          effectiveDate: new Date('2026-01-20T00:00:00.000Z'),
          channel: 'IN_APP',
        },
      }),
    ).rejects.toThrow();

    const validReversal = await prisma.paymentReversal.create({
      data: {
        organizationId: organizationB.id,
        paymentId: paymentB.id,
        amount: decimal('0.1000'),
        reason: 'Valid correction',
        reversalDate: new Date('2026-01-03T00:00:00.000Z'),
        reversedByUserId: user.id,
      },
    });
    expect(validReversal.paymentId).toBe(paymentB.id);
    await expect(
      prisma.paymentReversal.create({
        data: {
          organizationId: organizationB.id,
          paymentId: paymentB.id,
          amount: decimal('0.1000'),
          reason: 'Duplicate',
          reversalDate: new Date('2026-01-04T00:00:00.000Z'),
          reversedByUserId: user.id,
        },
      }),
    ).rejects.toThrow();
    expect(invoiceA.organizationId).toBe(organizationA.id);
  });

  test('preserves Decimal precision and validates numeric/date checks', async () => {
    const user = await createUser();
    const organization = await createOrganization();
    const customer = await createCustomer(organization.id, user.id);
    const invoice = await createInvoice(organization.id, customer.id, user.id, {
      discountType: 'FIXED',
      discountValue: decimal('0.200000'),
      taxRate: decimal('12.345678'),
      subtotal: decimal('123456.7890'),
      discountTotal: decimal('0.2000'),
      taxableTotal: decimal('123456.5890'),
      taxTotal: decimal('0.0000'),
      total: decimal('123456.5890'),
      amountPaid: decimal('0.1000'),
      balanceDue: decimal('123456.4890'),
    });
    const item = await prisma.invoiceItem.create({
      data: {
        organizationId: organization.id,
        invoiceId: invoice.id,
        description: 'Exact quantity',
        quantity: decimal('1.123456'),
        unitPrice: decimal('0.2000'),
        lineAmount: decimal('0.2000'),
        sortOrder: 0,
      },
    });
    const payment = await createPayment(organization.id, invoice.id, user.id, {
      amount: decimal('0.2000'),
    });
    expect(invoice.subtotal.toFixed(4)).toBe('123456.7890');
    expect(invoice.taxRate.toFixed(6)).toBe('12.345678');
    expect(item.quantity.toFixed(6)).toBe('1.123456');
    expect(payment.amount.toFixed(4)).toBe('0.2000');

    await expect(
      prisma.invoiceItem.create({
        data: {
          organizationId: organization.id,
          invoiceId: invoice.id,
          description: 'Bad',
          quantity: decimal('0'),
          unitPrice: decimal('1'),
          lineAmount: decimal('1'),
          sortOrder: 1,
        },
      }),
    ).rejects.toThrow();
    await expect(
      createPayment(organization.id, invoice.id, user.id, { amount: decimal('0') }),
    ).rejects.toThrow();
    const category = await prisma.expenseCategory.create({
      data: { organizationId: organization.id, name: 'Office', normalizedName: 'office' },
    });
    await expect(
      prisma.expense.create({
        data: {
          organizationId: organization.id,
          expenseCategoryId: category.id,
          amount: decimal('0'),
          currency: 'INR',
          expenseDate: new Date(),
          description: 'Bad',
          createdByUserId: user.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      createInvoice(organization.id, customer.id, user.id, { taxRate: decimal('100.000001') }),
    ).rejects.toThrow();
    await expect(
      createInvoice(organization.id, customer.id, user.id, {
        dueDate: new Date('2025-12-31T00:00:00.000Z'),
      }),
    ).rejects.toThrow();
    await expect(
      prisma.invoiceSequence.create({
        data: { organizationId: organization.id, nextValue: BigInt(0) },
      }),
    ).rejects.toThrow();
  });

  test('enforces idempotency, pending invitations, delete restrictions, and audit append-only history', async () => {
    const user = await createUser();
    const organization = await createOrganization();
    await prisma.idempotencyRecord.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        operation: 'payment.create',
        key: 'same-key',
        requestHash: 'a'.repeat(64),
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      },
    });
    await expect(
      prisma.idempotencyRecord.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          operation: 'payment.create',
          key: 'same-key',
          requestHash: 'b'.repeat(64),
          expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        },
      }),
    ).rejects.toThrow();

    const invitationData = {
      organizationId: organization.id,
      email: 'invite@example.test',
      normalizedEmail: 'invite@example.test',
      role: 'MEMBER',
      tokenHash: 'c'.repeat(64),
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      invitedByUserId: user.id,
    };
    await prisma.organizationInvitation.create({ data: invitationData });
    await expect(
      prisma.organizationInvitation.create({
        data: { ...invitationData, tokenHash: 'd'.repeat(64) },
      }),
    ).rejects.toThrow();

    const customer = await createCustomer(organization.id, user.id);
    const invoice = await createInvoice(organization.id, customer.id, user.id);
    await createPayment(organization.id, invoice.id, user.id);
    await expect(prisma.invoice.delete({ where: { id: invoice.id } })).rejects.toThrow();
    await expect(prisma.organization.delete({ where: { id: organization.id } })).rejects.toThrow();

    const audit = await prisma.auditLog.create({
      data: {
        organizationId: organization.id,
        actorType: 'USER',
        actorUserId: user.id,
        action: 'test.audit',
        entityType: 'Test',
        entityId: randomUUID(),
        source: 'SYSTEM',
      },
    });
    await expect(prisma.auditLog.delete({ where: { id: audit.id } })).rejects.toThrow();
    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();
  });
});
