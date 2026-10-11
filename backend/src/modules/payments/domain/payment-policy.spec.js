import { Prisma } from '@prisma/client';
import {
  paymentAmount,
  paymentDate,
  assertWithinBalance,
  reversalInput,
} from './payment-policy.js';
const d = (value) => new Prisma.Decimal(value);

describe('payment financial policy', () => {
  it('keeps currency-scale payments exact without rounding submitted amounts', () => {
    expect(paymentAmount('0.10', 'INR').toString()).toBe('0.1');
    expect(paymentAmount('999999999999999.99', 'INR').toString()).toBe('999999999999999.99');
    expect(paymentAmount('1.234', 'KWD').toString()).toBe('1.234');
    expect(paymentAmount('1', 'JPY').toString()).toBe('1');
    expect(() => paymentAmount('1.01', 'JPY')).toThrow();
    expect(() => paymentAmount('0.001', 'INR')).toThrow();
  });
  it.each(['0', '-1', '1e2', 'NaN', ' 1', '1.00001', '1000000000000000', 1])(
    'rejects invalid amount %s',
    (value) => {
      expect(() => paymentAmount(value, 'INR')).toThrow(
        expect.objectContaining({ code: 'INVALID_PAYMENT_AMOUNT' }),
      );
    },
  );
  it('accepts partial/full payments and rejects overpayment against the authoritative sum', () => {
    expect(() => assertWithinBalance(d('0.3'), d('0.1'), d('0.2'), 'INR')).not.toThrow();
    expect(() => assertWithinBalance(d('100'), d('20'), d('80'), 'INR')).not.toThrow();
    expect(() => assertWithinBalance(d('100'), d('20'), d('80.01'), 'INR')).toThrow(
      expect.objectContaining({
        code: 'PAYMENT_EXCEEDS_BALANCE',
        details: { currency: 'INR', remainingBalance: '80.00' },
      }),
    );
    expect(() => assertWithinBalance(d('100'), d('101'), d('1'), 'INR')).toThrow(
      expect.objectContaining({ code: 'INVOICE_SETTLEMENT_INCONSISTENT' }),
    );
  });
  it('validates real calendar dates and nonblank reversal reasons without inventing date-order restrictions', () => {
    expect(paymentDate('2024-02-29').toISOString()).toBe('2024-02-29T00:00:00.000Z');
    for (const value of ['2026-02-29', '2026-04-31', '0000-01-01', '2026-1-01'])
      expect(() => paymentDate(value)).toThrow(
        expect.objectContaining({ code: 'INVALID_PAYMENT_DATE' }),
      );
    expect(
      reversalInput({ reason: ' Corrected ', reversalDate: '2026-01-01', amount: '1' }),
    ).toEqual({ reason: 'Corrected', reversalDate: new Date('2026-01-01') });
    expect(() => reversalInput({ reason: ' ', reversalDate: '2026-01-01' })).toThrow();
  });
});
