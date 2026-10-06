import { cashFlowOptions, cashFlowResponse } from './cash-flow.js';

const organization = { baseCurrency: 'INR', timezone: 'Asia/Kolkata' };
const options = { fromDate: '2026-01-01', toDate: '2026-01-31', groupBy: 'month' };
describe('cash flow calendar and decimal rules', () => {
  it('defaults to the current organization-local month across a UTC month boundary', () => {
    expect(cashFlowOptions({}, organization.timezone, new Date('2026-01-31T20:00:00Z'))).toEqual({
      fromDate: '2026-02-01',
      toDate: '2026-02-28',
      groupBy: 'month',
    });
    expect(cashFlowOptions({}, 'America/Los_Angeles', new Date('2026-03-01T01:00:00Z'))).toEqual({
      fromDate: '2026-02-01',
      toDate: '2026-02-28',
      groupBy: 'month',
    });
  });
  it('accepts exactly 366 inclusive calendar dates and a single date', () => {
    expect(cashFlowOptions({ fromDate: '2024-01-01', toDate: '2024-12-31' }, 'UTC').toDate).toBe(
      '2024-12-31',
    );
    expect(
      cashFlowOptions({ fromDate: '2026-01-01', toDate: '2026-01-01', groupBy: 'day' }, 'UTC')
        .groupBy,
    ).toBe('day');
  });
  it.each([
    { fromDate: '2024-01-01', toDate: '2025-01-01' },
    { fromDate: '2026-02-02', toDate: '2026-02-01' },
    { fromDate: '2026-02-30' },
    { toDate: '2026-2-01' },
    { groupBy: 'year' },
  ])('rejects invalid calendar/range/group input %j', (query) => {
    expect(() => cashFlowOptions(query, 'UTC')).toThrow();
  });
  it('defaults only omitted bounds and includes leap-month endings', () => {
    expect(
      cashFlowOptions({ fromDate: '2024-02-10', groupBy: 'week' }, 'UTC', new Date('2024-02-01')),
    ).toEqual({ fromDate: '2024-02-10', toDate: '2024-02-29', groupBy: 'week' });
  });
  it('serializes empty ranges as zero totals and no fabricated periods', () => {
    expect(cashFlowResponse([], options, organization).data).toEqual({
      inflows: '0.00',
      outflows: '0.00',
      netCashFlow: '0.00',
      series: [],
    });
  });
  it('preserves aggregate precision beyond individual record limits and negative net', () => {
    const result = cashFlowResponse(
      [
        {
          periodStart: new Date('2026-01-01'),
          inflows: '1999999999999999.98',
          outflows: '2000000000000000.01',
        },
      ],
      options,
      organization,
    );
    expect(result.data).toMatchObject({
      inflows: '1999999999999999.98',
      outflows: '2000000000000000.01',
      netCashFlow: '-0.03',
    });
    expect(result.data.series[0].netCashFlow).toBe('-0.03');
  });
  it.each([
    ['JPY', '3'],
    ['KWD', '3.125'],
    ['CLF', '3.1250'],
  ])('uses %s currency scale', (currency, expected) => {
    expect(
      cashFlowResponse(
        [{ periodStart: new Date('2026-01-01'), inflows: '3.125', outflows: '0' }],
        options,
        { ...organization, baseCurrency: currency },
      ).data.inflows,
    ).toBe(expected);
  });
  it('fails safely if a selected source has another currency', () => {
    expect(() => cashFlowResponse([{ currencyMismatch: true }], options, organization)).toThrow(
      'Financial currency is inconsistent.',
    );
  });
});
