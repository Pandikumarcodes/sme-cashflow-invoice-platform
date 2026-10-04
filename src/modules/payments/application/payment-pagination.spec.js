import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  paymentListOptions,
  decodePaymentCursor,
  encodePaymentCursor,
  paymentListFilter,
} from './payment-pagination.js';

describe('payment cursor pagination', () => {
  it('supports exact amount/date tuples and binds scope, filters and sort order', () => {
    const organizationId = randomUUID();
    for (const sortBy of ['amount', 'paymentDate', 'recordedAt']) {
      const options = paymentListOptions(organizationId, { sortBy });
      const row = {
        id: randomUUID(),
        amount: new Prisma.Decimal('0.3'),
        paymentDate: new Date('2026-01-01'),
        recordedAt: new Date('2026-01-01'),
      };
      const cursor = encodePaymentCursor(row, options);
      expect(decodePaymentCursor(cursor, options).id).toBe(row.id);
      for (const different of [
        paymentListOptions(randomUUID(), { sortBy }),
        paymentListOptions(organizationId, { sortBy, method: 'UPI' }),
        paymentListOptions(organizationId, { sortBy, sortOrder: 'asc' }),
      ])
        expect(() => decodePaymentCursor(cursor, different)).toThrow(
          expect.objectContaining({ code: 'INVALID_CURSOR' }),
        );
      expect(paymentListFilter(options, decodePaymentCursor(cursor, options)).AND).toHaveLength(1);
    }
  });
  it('rejects malformed cursor keys and invalid/reversed/unbounded date ranges', () => {
    const options = paymentListOptions(randomUUID(), { sortBy: 'amount' });
    for (const value of [
      '=',
      'a'.repeat(2049),
      Buffer.from(
        JSON.stringify({
          v: 1,
          signature: options.signature,
          key: { id: [randomUUID()], value: '1' },
        }),
      ).toString('base64url'),
    ])
      expect(() => decodePaymentCursor(value, options)).toThrow();
    for (const query of [
      { paymentDateFrom: '2026-02-29' },
      { paymentDateFrom: '2026-02-01', paymentDateTo: '2026-01-01' },
      { paymentDateFrom: '2000-01-01', paymentDateTo: '2026-01-01' },
    ])
      expect(() => paymentListOptions(options.organizationId, query)).toThrow();
  });
});
