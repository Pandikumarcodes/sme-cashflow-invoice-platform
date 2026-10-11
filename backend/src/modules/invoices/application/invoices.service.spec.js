import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { InvoicesService } from './invoices.service.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { resolveTenantAccess } from '../../../common/tenancy/tenant-context.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import { CustomerInvoiceReader } from '../../customers/application/customer-invoice-reader.js';

describe('invoice application use cases', () => {
  const d = (value) => new Prisma.Decimal(value);
  let service;
  let tx;
  let tenant;
  let stored;
  let root;
  let organization;
  const customerId = randomUUID();
  const id = randomUUID();
  const body = () => ({
    customerId,
    issueDate: '2026-01-01',
    dueDate: '2026-01-31',
    discount: { type: 'NONE', value: '0' },
    taxRate: '0',
    items: [{ description: 'Work', quantity: '3', unitPrice: '33.335', sortOrder: 0 }],
  });
  beforeEach(async () => {
    organization = { id: randomUUID(), timezone: 'Asia/Kolkata', baseCurrency: 'INR' };
    const membership = {
      id: randomUUID(),
      organizationId: organization.id,
      role: 'OWNER',
      organization,
    };
    stored = {
      id,
      customerId,
      organizationId: organization.id,
      currency: 'INR',
      status: 'DRAFT',
      invoiceNumber: null,
      sequenceValue: null,
      numberPrefix: null,
      issueDate: new Date('2026-01-01'),
      dueDate: new Date('2026-01-31'),
      discountType: 'NONE',
      discountValue: d('0'),
      taxRate: d('0'),
      subtotal: d('100.01'),
      discountTotal: d('0'),
      taxableTotal: d('100.01'),
      taxTotal: d('0'),
      total: d('100.01'),
      amountPaid: d('0'),
      balanceDue: d('100.01'),
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      issuedAt: null,
      billToName: null,
      billToEmail: null,
      customer: { displayName: 'Customer', email: null },
      items: [
        {
          ...body().items[0],
          id: randomUUID(),
          quantity: d('3'),
          unitPrice: d('33.335'),
          lineAmount: d('100.01'),
        },
      ],
    };
    tx = {
      membership: { findFirst: jest.fn().mockResolvedValue(membership) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      customer: {
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(
            where.id === customerId
              ? { id: customerId, displayName: 'Customer', email: null, status: 'ACTIVE' }
              : null,
          ),
        ),
      },
      invoice: {
        create: jest.fn(({ data }) => {
          stored = { ...stored, ...data };
          return Promise.resolve(stored);
        }),
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(stored)),
        update: jest.fn(({ data }) => {
          const version = stored.version + 1;
          stored = { ...stored, ...data, version };
          return Promise.resolve(stored);
        }),
      },
      invoiceItem: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      pendingEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    root = {
      ...tx,
      $transaction: jest.fn((operation) => operation(tx)),
      auditLog: { create: jest.fn() },
    };
    const authorization = new AuthorizationService();
    tenant = (
      await resolveTenantAccess(
        tx,
        { userId: randomUUID(), sessionId: randomUUID() },
        organization.id,
        authorization,
        [PERMISSIONS.INVOICE_CREATE],
      )
    ).tenant;
    service = new InvoicesService(
      { getClient: async () => root },
      authorization,
      new CustomerInvoiceReader(),
      { lock: jest.fn().mockResolvedValue(organization) },
    );
  });
  it('creates a server-owned draft and records its mandatory audit on the transaction client', async () => {
    const result = await service.create(tenant, {
      ...body(),
      organizationId: randomUUID(),
      currency: 'USD',
      total: '1',
      status: 'VOID',
    });
    expect(result).toMatchObject({
      organizationId: tenant.organizationId,
      currency: 'INR',
      status: 'DRAFT',
      total: '100.01',
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'INVOICE_CREATED', actorUserId: tenant.userId }),
      }),
    );
    expect(root.auditLog.create).not.toHaveBeenCalled();
  });
  it('uses scoped customer and invoice predicates and conceals missing customers', async () => {
    await expect(
      service.create(tenant, { ...body(), customerId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(tx.customer.findFirst).toHaveBeenCalledWith({
      where: { id: expect.any(String), organizationId: tenant.organizationId },
    });
    await service.get(tenant, id);
    expect(tx.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id, organizationId: tenant.organizationId } }),
    );
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });
  it('recalculates draft edits while rejecting stale or finalized mutations before writing', async () => {
    expect((await service.update(tenant, id, 1, { taxRate: '18' })).total).toBe('118.01');
    await expect(service.update(tenant, id, 1, { taxRate: '0' })).rejects.toMatchObject({
      code: 'CONCURRENT_MODIFICATION',
    });
    stored.status = 'ISSUED';
    await expect(service.update(tenant, id, 2, { taxRate: '0' })).rejects.toMatchObject({
      code: 'INVOICE_FINALIZED',
    });
    expect(tx.invoice.update).toHaveBeenCalledTimes(1);
  });
  it('issues through the transaction-bound allocator, snapshots the customer and audits/events exactly once', async () => {
    service.persistence.allocate = jest
      .fn()
      .mockResolvedValue({ invoiceNumber: 'INV-000001', sequenceValue: 1n, numberPrefix: 'INV-' });
    const issued = await service.issue(tenant, id, 1);
    expect(issued).toMatchObject({
      invoiceNumber: 'INV-000001',
      status: 'ISSUED',
      total: '100.01',
      version: 2,
      customer: { displayName: 'Customer' },
    });
    expect(service.persistence.allocate).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ organizationId: tenant.organizationId }),
      organization,
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'INVOICE_ISSUED' }) }),
    );
    expect(tx.pendingEvent.create).toHaveBeenCalledTimes(1);
    await expect(service.issue(tenant, id, 2)).rejects.toMatchObject({
      code: 'INVALID_INVOICE_STATE',
    });
    expect(service.persistence.allocate).toHaveBeenCalledTimes(1);
  });
});
