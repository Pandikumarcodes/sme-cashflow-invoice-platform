import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { InvoiceSettlement } from './invoice-settlement.js';
import { resolveTenantAccess } from '../../../common/tenancy/tenant-context.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
const d = (value) => new Prisma.Decimal(value);

describe('invoice settlement boundary', () => {
  const service = new InvoiceSettlement();
  const invoice = {
    id: 'invoice',
    currency: 'INR',
    status: 'ISSUED',
    total: d('0.3'),
    amountPaid: d('0.1'),
    balanceDue: d('0.2'),
    version: 2,
    dueDate: new Date('2026-01-01'),
  };
  it('requires ISSUED lifecycle and fails closed on cache drift', () => {
    expect(() => service.verify(invoice, d('0.1'))).not.toThrow();
    expect(() => service.verify(invoice, d('0.2'))).toThrow(
      expect.objectContaining({ code: 'INVOICE_SETTLEMENT_INCONSISTENT' }),
    );
    for (const status of ['DRAFT', 'VOID', 'CANCELLED'])
      expect(() => service.requireIssued({ ...invoice, status })).toThrow(
        expect.objectContaining({ code: 'INVALID_INVOICE_STATE' }),
      );
  });
  it('derives partial/full/unpaid states while preserving ISSUED lifecycle', () => {
    expect(service.summary(invoice, 'UTC')).toMatchObject({
      paymentState: 'PARTIALLY_PAID',
      amountPaid: '0.10',
      balanceDue: '0.20',
      status: 'ISSUED',
    });
    expect(
      service.summary({ ...invoice, amountPaid: d('0.3'), balanceDue: d('0') }, 'UTC').paymentState,
    ).toBe('PAID');
    expect(
      service.summary({ ...invoice, amountPaid: d('0'), balanceDue: d('0.3') }, 'UTC').paymentState,
    ).toBe('UNPAID');
  });
  it('updates only settlement caches/version through the supplied tenant transaction client', async () => {
    const client = {
      membership: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ organizationId: 'tenant', role: 'OWNER', id: 'member' }),
      },
      invoice: { update: jest.fn().mockResolvedValue({}) },
    };
    const { tenant } = await resolveTenantAccess(
      client,
      { userId: 'user', sessionId: 'session' },
      'tenant',
      new AuthorizationService(),
      [PERMISSIONS.PAYMENT_CREATE],
    );
    await service.apply(client, tenant, invoice, d('0.3'));
    const update = client.invoice.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'invoice', organizationId: 'tenant', status: 'ISSUED' });
    expect(Object.keys(update.data).sort()).toEqual(['amountPaid', 'balanceDue', 'version']);
    expect(update.data.amountPaid).toBeInstanceOf(Prisma.Decimal);
    expect(update.data.balanceDue.toString()).toBe('0');
  });
});
