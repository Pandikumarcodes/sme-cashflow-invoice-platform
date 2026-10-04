import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  invoiceListOptions,
  decodeInvoiceCursor,
  encodeInvoiceCursor,
  invoiceListFilter,
} from './invoice-pagination.js';

describe('invoice pagination contract', () => {
  it('binds cursors to tenant, filters and ordering and validates numeric/date/null tuples', () => {
    const tenant = randomUUID();
    for (const [sortBy, value] of [
      ['total', new Prisma.Decimal('100.01')],
      ['invoiceNumber', null],
      ['issueDate', new Date('2026-01-01')],
    ]) {
      const options = invoiceListOptions(tenant, { sortBy }, 'UTC');
      const cursor = encodeInvoiceCursor({ id: randomUUID(), [sortBy]: value }, options);
      expect(decodeInvoiceCursor(cursor, options)).toMatchObject({
        value:
          value === null ? null : value instanceof Date ? value.toISOString() : value.toString(),
      });
      for (const different of [
        invoiceListOptions(randomUUID(), { sortBy }, 'UTC'),
        invoiceListOptions(tenant, { sortBy, status: 'DRAFT' }, 'UTC'),
        invoiceListOptions(tenant, { sortBy, sortOrder: 'asc' }, 'UTC'),
      ])
        expect(() => decodeInvoiceCursor(cursor, different)).toThrow(
          expect.objectContaining({ code: 'INVALID_CURSOR' }),
        );
    }
  });
  it('rejects invalid/tampered cursor shapes and supports null-last seek predicates', () => {
    const options = invoiceListOptions(randomUUID(), { sortBy: 'invoiceNumber' }, 'UTC');
    for (const value of ['', '====', Buffer.from('{}').toString('base64url'), 'a'.repeat(2049)])
      expect(() => decodeInvoiceCursor(value, options)).toThrow();
    expect(invoiceListFilter(options, { id: randomUUID(), value: null }).AND).toEqual([
      expect.objectContaining({ invoiceNumber: null }),
    ]);
  });
  it('enforces calendar/range bounds and filters overdue independently of payment state', () => {
    for (const query of [
      { issueDateFrom: '2026-02-29' },
      { issueDateFrom: '2026-02-01', issueDateTo: '2026-01-01' },
      { dueDateFrom: '2000-01-01', dueDateTo: '2026-01-01' },
    ])
      expect(() => invoiceListOptions(randomUUID(), query, 'UTC')).toThrow();
    const options = invoiceListOptions(
      randomUUID(),
      { overdue: 'true', paymentState: 'PARTIALLY_PAID' },
      'UTC',
    );
    const filters = invoiceListFilter(options, null).AND;
    expect(filters).toContainEqual({
      status: 'ISSUED',
      amountPaid: { gt: '0' },
      balanceDue: { gt: '0' },
    });
    expect(filters).toContainEqual(
      expect.objectContaining({ dueDate: expect.any(Object), status: 'ISSUED' }),
    );
  });
});
