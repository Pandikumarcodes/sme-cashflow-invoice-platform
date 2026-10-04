import { Prisma } from '@prisma/client';
import {
  assertDraft,
  businessDate,
  invoiceDates,
  localDate,
  settlementState,
} from './invoice-policy.js';
const d = (value) => new Prisma.Decimal(value);

describe('invoice lifecycle and date policy', () => {
  it('allows current drafts, rejects stale edits and all finalized lifecycle edits', () => {
    expect(() => assertDraft({ status: 'DRAFT', version: 2 }, 2)).not.toThrow();
    expect(() => assertDraft({ status: 'DRAFT', version: 2 }, 1)).toThrow(
      expect.objectContaining({ code: 'CONCURRENT_MODIFICATION' }),
    );
    for (const status of ['ISSUED', 'CANCELLED', 'VOID']) {
      expect(() => assertDraft({ status, version: 2 }, 2)).toThrow(
        expect.objectContaining({ code: 'INVOICE_FINALIZED' }),
      );
      expect(() => assertDraft({ status, version: 2 }, 2, true)).toThrow(
        expect.objectContaining({ code: 'INVALID_INVOICE_STATE' }),
      );
    }
  });
  it('uses real business dates and due >= issue, including leap boundaries', () => {
    expect(businessDate('2024-02-29').toISOString()).toBe('2024-02-29T00:00:00.000Z');
    for (const value of ['2026-02-29', '2026-04-31', '2026-1-01', '0000-01-01'])
      expect(() => businessDate(value)).toThrow();
    expect(() => invoiceDates('2026-01-02', '2026-01-01')).toThrow();
    expect(() => invoiceDates('2026-01-02', '2026-01-02')).not.toThrow();
  });
  it('derives overdue from tenant-local today, positive balance and issued lifecycle', () => {
    const instant = new Date('2026-01-02T01:00:00Z');
    expect(localDate('America/Los_Angeles', instant)).toBe('2026-01-01');
    const invoice = {
      status: 'ISSUED',
      total: d('10'),
      amountPaid: d('0'),
      balanceDue: d('10'),
      dueDate: businessDate('2026-01-01'),
    };
    expect(settlementState(invoice, 'America/Los_Angeles', instant)).toEqual({
      paymentState: 'UNPAID',
      isOverdue: false,
    });
    expect(settlementState(invoice, 'Asia/Kolkata', instant).isOverdue).toBe(true);
    expect(
      settlementState({ ...invoice, amountPaid: d('4'), balanceDue: d('6') }, 'UTC', instant)
        .paymentState,
    ).toBe('PARTIALLY_PAID');
    expect(
      settlementState({ ...invoice, amountPaid: d('10'), balanceDue: d('0') }, 'UTC', instant),
    ).toEqual({ paymentState: 'PAID', isOverdue: false });
    expect(settlementState({ ...invoice, status: 'VOID' }, 'UTC', instant)).toEqual({
      paymentState: 'NOT_APPLICABLE',
      isOverdue: false,
    });
    expect(() => settlementState({ ...invoice, balanceDue: d('9') }, 'UTC', instant)).toThrow();
  });
});
