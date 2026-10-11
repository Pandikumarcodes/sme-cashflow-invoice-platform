import { analyticsOptions, analyticsSummaryResponse, agingResponse } from './analytics.js';
import { cashFlowResponse } from './cash-flow.js';
const org = { baseCurrency: 'INR', timezone: 'Asia/Kolkata' };
const options = { fromDate: '2026-01-01', toDate: '2026-01-31', asOfDate: '2026-02-01' };
const empty = {
  totalInvoiced: '0',
  cohortCollected: '0',
  outstanding: '0',
  overdue: '0',
  delayDays: '0',
  sampleSize: 0,
  draftCount: 0,
  issuedCount: 0,
  cancelledCount: 0,
  voidCount: 0,
};
const cash = cashFlowResponse([], { ...options, groupBy: 'month' }, org);
describe('analytics date, ratio and presentation semantics', () => {
  it('resolves tenant-local current month and today at a UTC boundary', () => {
    expect(analyticsOptions({}, org.timezone, true, new Date('2026-01-31T20:00:00Z'))).toEqual({
      fromDate: '2026-02-01',
      toDate: '2026-02-28',
      asOfDate: '2026-02-01',
    });
    expect(
      analyticsOptions({}, 'America/Los_Angeles', false, new Date('2026-03-01T01:00:00Z')),
    ).toEqual({ asOfDate: '2026-02-28' });
  });
  it.each([
    { fromDate: '2026-02-30' },
    { asOfDate: '2026-02-30' },
    { ...options, asOfDate: '2025-12-31' },
    { fromDate: '2024-01-01', toDate: '2025-01-01' },
    { ...options, toDate: '2025-12-31' },
  ])('rejects invalid date semantics %j', (query) => {
    expect(() => analyticsOptions(query, 'UTC')).toThrow();
  });
  it('accepts exactly 366 inclusive dates and an as-of after the range', () => {
    expect(
      analyticsOptions(
        { fromDate: '2024-01-01', toDate: '2024-12-31', asOfDate: '2025-01-01' },
        'UTC',
      ).toDate,
    ).toBe('2024-12-31');
  });
  it('returns zero amounts/counts and null ratios/delays for empty samples', () => {
    const result = analyticsSummaryResponse(empty, cash, 0, options, org);
    expect(result.data.collections).toEqual({
      collected: '0.00',
      rate: null,
      averagePaymentDelayDays: null,
      sampleSize: 0,
    });
    expect(result.data.billing.totalInvoiced).toBe('0.00');
    expect(result.data.customers.activeCount).toBe(0);
    expect(
      agingResponse([], { asOfDate: options.asOfDate }, org).data.buckets.map((row) => row.amount),
    ).toEqual(Array(5).fill('0.00'));
  });
  it('uses the invoice cohort denominator rather than period receipts, with exact rounding and early-payment delay', () => {
    const result = analyticsSummaryResponse(
      { ...empty, totalInvoiced: '3', cohortCollected: '1', delayDays: '-1', sampleSize: 3 },
      cash,
      2,
      options,
      org,
    );
    expect(result.data.collections).toEqual({
      collected: '0.00',
      rate: '33.3333',
      averagePaymentDelayDays: '-0.33',
      sampleSize: 3,
    });
  });
  it('preserves large money and canonical negative cash results', () => {
    const flows = cashFlowResponse(
      [{ periodStart: new Date('2026-01-01'), inflows: '0.10', outflows: '0.30' }],
      options,
      org,
    );
    const result = analyticsSummaryResponse(
      { ...empty, totalInvoiced: '1999999999999999.98', outstanding: '1999999999999999.98' },
      flows,
      0,
      options,
      org,
    );
    expect(result.data.receivables.outstanding).toBe('1999999999999999.98');
    expect(result.data.cash).toEqual({ netCashFlow: '-0.20', netResult: '-0.20' });
  });
  it('sums only overdue aging buckets and uses a deterministic five-bucket response', () => {
    const result = agingResponse(
      [
        { bucket: '1_30', invoiceCount: 2, amount: '0.30' },
        { bucket: 'CURRENT', invoiceCount: 1, amount: '10' },
      ],
      { asOfDate: options.asOfDate },
      org,
    );
    expect(result.data.outstanding).toBe('10.30');
    expect(result.data.overdue).toBe('0.30');
    expect(result.data.buckets.map((row) => row.bucket)).toEqual([
      'CURRENT',
      '1_30',
      '31_60',
      '61_90',
      '91_PLUS',
    ]);
  });
  it.each([
    { currencyMismatch: true, code: 'CURRENCY_MISMATCH' },
    { invalidSettlement: true, code: 'INVOICE_SETTLEMENT_INCONSISTENT' },
  ])('fails closed on corrupt facts %j', (input) => {
    expect(() =>
      agingResponse([{ bucket: 'CURRENT', amount: '0', invoiceCount: 0, ...input }], {}, org),
    ).toThrow();
    expect(() => analyticsSummaryResponse({ ...empty, ...input }, cash, 0, options, org)).toThrow();
  });
});
