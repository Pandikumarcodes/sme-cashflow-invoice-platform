import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service.js';
import { InvoiceSettlement } from '../../invoices/application/invoice-settlement.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { resolveTenantAccess } from '../../../common/tenancy/tenant-context.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import { ApplicationError } from '../../../common/errors/application-error.js';

describe('payment use case orchestration', () => {
  const d = (value) => new Prisma.Decimal(value);
  const input = { amount: '25', paymentDate: '2026-01-02', method: 'BANK_TRANSFER' };
  let tx;
  let root;
  let invoices;
  let persistence;
  let idempotency;
  let service;
  let tenant;
  let invoice;
  let payment;
  beforeEach(async () => {
    invoice = {
      id: 'invoice',
      invoiceNumber: 'INV-1',
      currency: 'INR',
      status: 'ISSUED',
      total: d('100'),
      amountPaid: d('0'),
      balanceDue: d('100'),
      version: 2,
      dueDate: new Date('2026-01-31'),
    };
    payment = {
      id: 'payment',
      organizationId: 'tenant',
      invoiceId: 'invoice',
      amount: d('25'),
      currency: 'INR',
      status: 'RECORDED',
      paymentMethod: 'BANK_TRANSFER',
      paymentDate: new Date('2026-01-02'),
      createdByUserId: 'user',
      recordedAt: new Date('2026-01-02'),
      createdAt: new Date('2026-01-02'),
      updatedAt: new Date('2026-01-02'),
      reversedAt: null,
      reversal: null,
    };
    tx = {
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'member',
          organizationId: 'tenant',
          role: 'OWNER',
          organization: { baseCurrency: 'INR', timezone: 'UTC' },
        }),
      },
      payment: { create: jest.fn().mockResolvedValue(payment), update: jest.fn() },
      paymentReversal: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      pendingEvent: { create: jest.fn() },
    };
    root = { $transaction: jest.fn(async (operation) => operation(tx)) };
    const authorization = new AuthorizationService();
    tenant = (
      await resolveTenantAccess(
        tx,
        { userId: 'user', sessionId: 'session' },
        'tenant',
        authorization,
        [PERMISSIONS.PAYMENT_CREATE],
      )
    ).tenant;
    invoices = new InvoiceSettlement();
    invoices.find = jest.fn().mockResolvedValue(invoice);
    invoices.lock = jest.fn().mockResolvedValue(invoice);
    invoices.apply = jest
      .fn()
      .mockResolvedValue({ ...invoice, amountPaid: d('25'), balanceDue: d('75'), version: 3 });
    persistence = {
      activeTotal: jest.fn().mockResolvedValueOnce(d('0')).mockResolvedValueOnce(d('25')),
      find: jest.fn().mockResolvedValue(payment),
    };
    idempotency = {
      claim: jest.fn().mockResolvedValue({ record: { id: 'claim' }, replayed: false }),
      complete: jest.fn(),
    };
    service = new PaymentsService(
      { getClient: async () => root },
      authorization,
      invoices,
      persistence,
      idempotency,
    );
  });
  it('passes one transaction client to every participant and persists trusted actors with ID-only events', async () => {
    const result = await service.record(tenant, 'invoice', input, 'key-for-record-001');
    expect(result).toMatchObject({
      httpStatus: 201,
      data: { amount: '25.00', invoice: { balanceDue: '75.00', paymentState: 'PARTIALLY_PAID' } },
    });
    expect(root.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'ReadCommitted',
      timeout: 15000,
    });
    for (const fn of [
      invoices.find,
      invoices.lock,
      invoices.apply,
      persistence.find,
      persistence.activeTotal,
      idempotency.claim,
      idempotency.complete,
    ])
      for (const call of fn.mock.calls) expect(call[0]).toBe(tx);
    expect(tx.payment.create.mock.calls[0][0].data).toMatchObject({
      organizationId: 'tenant',
      createdByUserId: 'user',
      currency: 'INR',
      amount: d('25'),
    });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      actorMembershipId: 'member',
      actorSessionId: 'session',
      action: 'PAYMENT_RECORDED',
      source: 'API',
    });
    expect(tx.pendingEvent.create.mock.calls[0][0].data.payload).toMatchObject({
      version: 1,
      paymentId: 'payment',
      invoiceId: 'invoice',
      invoiceVersion: 3,
    });
    expect(tx.pendingEvent.create.mock.calls[0][0].data.payload).not.toHaveProperty('amount');
  });
  it('rejects overpayment before payment, audit, event or completion writes', async () => {
    await expect(
      service.record(tenant, 'invoice', { ...input, amount: '101' }, 'key-for-record-001'),
    ).rejects.toMatchObject({
      code: 'PAYMENT_EXCEEDS_BALANCE',
      details: { remainingBalance: '100.00' },
    });
    for (const fn of [
      tx.payment.create,
      tx.auditLog.create,
      tx.pendingEvent.create,
      idempotency.complete,
    ])
      expect(fn).not.toHaveBeenCalled();
  });
  it('conceals a foreign invoice before any claim and rechecks membership inside the transaction', async () => {
    invoices.find.mockRejectedValue(
      new ApplicationError('RESOURCE_NOT_FOUND', 'Invoice not found.'),
    );
    await expect(
      service.record(tenant, 'foreign', input, 'key-for-record-001'),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(idempotency.claim).not.toHaveBeenCalled();
    tx.membership.findFirst.mockResolvedValue(null);
    await expect(
      service.record(tenant, 'invoice', input, 'key-for-record-001'),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
  it('locks Invoice before Payment and rejects a second reversal without financial writes', async () => {
    persistence.find.mockResolvedValue({ ...payment, status: 'REVERSED' });
    await expect(
      service.reverse(
        tenant,
        'payment',
        { reason: 'Wrong', reversalDate: '2026-01-03' },
        'key-for-reverse-01',
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_ALREADY_REVERSED' });
    expect(invoices.lock.mock.invocationCallOrder[0]).toBeLessThan(
      persistence.find.mock.invocationCallOrder[1],
    );
    expect(persistence.find.mock.calls[1]).toEqual([
      tx,
      expect.objectContaining({ organizationId: 'tenant' }),
      'payment',
      true,
    ]);
    expect(tx.paymentReversal.create).not.toHaveBeenCalled();
    expect(invoices.apply).not.toHaveBeenCalled();
  });
  it('rejects every ineligible lifecycle before financial writes', async () => {
    for (const status of ['DRAFT', 'CANCELLED', 'VOID']) {
      invoices.lock.mockResolvedValue({ ...invoice, status });
      await expect(
        service.record(tenant, 'invoice', input, 'key-for-record-001'),
      ).rejects.toMatchObject({ code: 'INVALID_INVOICE_STATE' });
    }
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(invoices.apply).not.toHaveBeenCalled();
  });
  it('reverses the original Decimal amount in full and returns restored unpaid settlement', async () => {
    invoice = { ...invoice, amountPaid: d('25'), balanceDue: d('75'), version: 3 };
    invoices.lock.mockResolvedValue(invoice);
    persistence.activeTotal
      .mockReset()
      .mockResolvedValueOnce(d('25'))
      .mockResolvedValueOnce(d('0'));
    const reversed = {
      ...payment,
      status: 'REVERSED',
      reversedAt: new Date('2026-01-03'),
      reversal: {
        id: 'reversal',
        paymentId: 'payment',
        amount: payment.amount,
        reason: 'Wrong',
        reversalDate: new Date('2026-01-03'),
        reversedByUserId: 'user',
        createdAt: new Date('2026-01-03'),
      },
    };
    persistence.find
      .mockReset()
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce(reversed);
    invoices.apply.mockResolvedValue({
      ...invoice,
      amountPaid: d('0'),
      balanceDue: d('100'),
      version: 4,
    });
    const result = await service.reverse(
      tenant,
      'payment',
      { reason: ' Wrong ', reversalDate: '2026-01-03' },
      'key-for-reverse-01',
    );
    expect(tx.paymentReversal.create.mock.calls[0][0].data).toMatchObject({
      organizationId: 'tenant',
      paymentId: 'payment',
      amount: payment.amount,
      reason: 'Wrong',
      reversedByUserId: 'user',
    });
    expect(tx.paymentReversal.create.mock.calls[0][0].data.amount).toBeInstanceOf(Prisma.Decimal);
    expect(Object.keys(tx.payment.update.mock.calls[0][0].data).sort()).toEqual([
      'reversedAt',
      'status',
    ]);
    expect(result).toMatchObject({
      httpStatus: 200,
      data: {
        status: 'REVERSED',
        amount: '25.00',
        reversal: { amount: '25.00' },
        invoice: {
          status: 'ISSUED',
          paymentState: 'UNPAID',
          amountPaid: '0.00',
          balanceDue: '100.00',
          version: 4,
        },
      },
    });
    for (const fn of [
      invoices.lock,
      invoices.apply,
      persistence.find,
      persistence.activeTotal,
      idempotency.claim,
      idempotency.complete,
    ])
      for (const call of fn.mock.calls) expect(call[0]).toBe(tx);
  });
  it('propagates side-effect failure to the application transaction and never completes the claim', async () => {
    tx.pendingEvent.create.mockRejectedValue(new Error('event unavailable'));
    await expect(service.record(tenant, 'invoice', input, 'key-for-record-001')).rejects.toThrow(
      'event unavailable',
    );
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(idempotency.complete).not.toHaveBeenCalled();
  });
});
