import { cashFlowResponse } from './cash-flow.js';
import { profitLossOptions, profitLossResponse } from './profit-loss.js';

const organization = { baseCurrency: 'INR', timezone: 'Asia/Kolkata' };
const options = { fromDate: '2026-01-01', toDate: '2026-02-28', groupBy: 'month' };
const report = (incoming, outgoing, currency = 'INR') => {
  const org = { ...organization, baseCurrency: currency };
  return profitLossResponse(
    cashFlowResponse(
      [{ periodStart: new Date('2026-01-01'), inflows: incoming, outflows: outgoing }],
      options,
      org,
    ),
    [],
    options,
    org,
  );
};
describe('simplified cash-basis performance', () => {
  it.each([
    ['10.10', '0.00', '10.10'],
    ['0.00', '10.20', '-10.20'],
    ['10.20', '10.10', '0.10'],
    ['10.10', '10.20', '-0.10'],
    ['10.10', '10.10', '0.00'],
    ['1999999999999999.98', '2000000000000000.01', '-0.03'],
  ])(
    'uses the canonical exact result for %s revenue and %s expenses',
    (revenue, expenses, expected) => {
      const result = report(revenue, expenses);
      expect(result.data.netResult).toBe(expected);
      expect(result.data.series[0].netResult).toBe(expected);
      expect(result.data.revenue).toBe(revenue);
      expect(result.meta).toMatchObject({
        basis: 'SIMPLIFIED_CASH',
        disclaimer: 'Not a GAAP/IFRS financial statement.',
        currency: 'INR',
      });
    },
  );
  it('uses currency scale and half-away-from-zero serialization without a record-sized sum limit', () => {
    expect(report('2.5000', '0', 'JPY').data.revenue).toBe('3');
    expect(report('0', '2.5000', 'JPY').data.netResult).toBe('-3');
    expect(report('3.125', '0', 'KWD').data.revenue).toBe('3.125');
  });
  it('returns zero empty reports and omits series only for none grouping', () => {
    const cash = cashFlowResponse([], options, organization);
    expect(profitLossResponse(cash, [], options, organization).data).toEqual({
      revenue: '0.00',
      expenses: '0.00',
      netResult: '0.00',
      expenseByCategory: [],
      series: [],
    });
    expect(
      profitLossResponse(cash, [], { ...options, groupBy: 'none' }, organization).data,
    ).toEqual({ revenue: '0.00', expenses: '0.00', netResult: '0.00', expenseByCategory: [] });
  });
  it('serializes exact category aggregates and preserves chronological partial-month labels', () => {
    const cash = cashFlowResponse(
      [
        { periodStart: new Date('2026-01-01'), inflows: '0.10', outflows: '0.20' },
        { periodStart: new Date('2026-02-01'), inflows: '0.20', outflows: '0.10' },
      ],
      options,
      organization,
    );
    const result = profitLossResponse(
      cash,
      [{ categoryId: 'category', categoryName: 'Costs', amount: '0.30' }],
      options,
      organization,
    );
    expect(result.data).toMatchObject({
      revenue: '0.30',
      expenses: '0.30',
      netResult: '0.00',
      expenseByCategory: [{ categoryId: 'category', categoryName: 'Costs', amount: '0.30' }],
    });
    expect(result.data.series.map((period) => period.periodStart)).toEqual([
      '2026-01-01',
      '2026-02-01',
    ]);
  });
  it('shares organization-local month defaults across UTC boundaries and allows none', () => {
    expect(profitLossOptions({}, 'Asia/Kolkata', new Date('2026-01-31T20:00:00Z'))).toEqual({
      fromDate: '2026-02-01',
      toDate: '2026-02-28',
      groupBy: 'month',
    });
    expect(
      profitLossOptions(
        { groupBy: 'none' },
        'America/Los_Angeles',
        new Date('2024-03-01T01:00:00Z'),
      ),
    ).toEqual({ fromDate: '2024-02-01', toDate: '2024-02-29', groupBy: 'none' });
  });
  it('accepts a single date and exactly 366 inclusive dates', () => {
    expect(profitLossOptions({ fromDate: '2024-01-01', toDate: '2024-12-31' }, 'UTC').toDate).toBe(
      '2024-12-31',
    );
    expect(
      profitLossOptions({ fromDate: '2026-01-01', toDate: '2026-01-01', groupBy: 'none' }, 'UTC')
        .groupBy,
    ).toBe('none');
  });
  it.each([
    { groupBy: 'day' },
    { groupBy: 'week' },
    { groupBy: 'year' },
    { fromDate: '2026-02-30' },
    { fromDate: '2026-02-02', toDate: '2026-02-01' },
    { fromDate: '2024-01-01', toDate: '2025-01-01' },
  ])('rejects unsupported grouping or invalid range %j', (query) => {
    expect(() => profitLossOptions(query, 'UTC')).toThrow();
  });
});
