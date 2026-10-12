import { expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { parseCashReport, parseProfitReport, reportRangeError, periodFloor } from './contracts';
import { parseAgingReport } from '../analytics/contracts';
import { cashReport, profitReport, agingReport, range } from './test-fixtures';
import { financialKeys, invalidateFinancialReads } from './query-keys';
import { chartPoints, formatMoney } from '../dashboard/money';
import { localToday } from '../dashboard/dates';
it.each(['day', 'week', 'month'] as const)(
  'accepts %s grouping and its partially populated first bucket',
  (group) => {
    const body = cashReport(range, group);
    expect(parseCashReport(body, range, group, 'USD', 'UTC')).toEqual(body);
  },
);
it.each([
  ['2024-01-01', '2024-12-31', undefined],
  ['2023-01-01', '2024-01-01', undefined],
  ['2024-01-01', '2025-01-01', '366'],
  ['2024-02-30', '2024-03-01', 'calendar'],
  ['2024-03-10', '2024-03-09', '366'],
  ['2028-01-01', '2028-01-31', undefined],
])('validates inclusive calendar range %s to %s', (from, to, error) => {
  const result = reportRangeError(from!, to!);
  if (error) expect(result).toContain(error);
  else expect(result).toBeUndefined();
});
it('uses organization-local business dates at midnight boundaries', () => {
  const now = new Date('2024-03-01T00:30:00Z');
  expect(localToday('America/Los_Angeles', now)).toBe('2024-02-29');
  expect(localToday('Asia/Kolkata', now)).toBe('2024-03-01');
});
it('uses Monday starts across month boundaries', () =>
  expect(periodFloor('2024-03-01', 'week')).toBe('2024-02-26'));
it('preserves large Decimal strings and negative net values through normalized chart coordinates', () => {
  const report = parseCashReport(cashReport(), range, 'month', 'USD', 'UTC');
  expect(report.data.inflows).toBe('12345678901234567890.10');
  expect(formatMoney(report.data.inflows, 'USD')).toBe('$12,345,678,901,234,567,890.10');
  expect(formatMoney(report.data.netCashFlow, 'USD')).toBe('-$10.15');
  expect(chartPoints(report.data.series).points[0]?.inflows).toBe(report.data.inflows);
  expect(chartPoints(report.data.series).points[0]?.incoming).toBe(1);
});
it('accepts empty cash series without manufacturing periods', () => {
  const body = cashReport();
  body.data.series = [];
  expect(parseCashReport(body, range, 'month', 'USD', 'UTC').data.series).toEqual([]);
});
it.each([
  ['JPY', '100'],
  ['KWD', '100.125'],
  ['CLF', '100.1250'],
])('preserves %s currency minor precision', (currency, amount) => {
  const body = cashReport();
  body.meta.currency = currency!;
  body.data.inflows = amount!;
  body.data.outflows = amount!;
  body.data.netCashFlow = amount!;
  body.data.series = [
    { periodStart: '2024-02-01', inflows: amount!, outflows: amount!, netCashFlow: amount! },
  ];
  expect(parseCashReport(body, range, 'month', currency!, 'UTC').data.inflows).toBe(amount);
});
it.each(['metadata', 'group', 'duplicate', 'alignment', 'numeric', 'scale', 'missing'] as const)(
  'rejects unsafe cash response: %s',
  (kind) => {
    const body = cashReport();
    if (kind === 'metadata') body.meta.timezone = 'Asia/Kolkata';
    if (kind === 'group') body.meta.groupBy = 'day';
    if (kind === 'duplicate') body.data.series.push(body.data.series[0]!);
    if (kind === 'alignment') body.data.series[0]!.periodStart = '2024-02-14';
    if (kind === 'numeric') Object.assign(body.data, { inflows: 100 });
    if (kind === 'scale') body.data.outflows = '200.250';
    if (kind === 'missing') Object.assign(body.data, { series: undefined });
    expect(() => parseCashReport(body, range, 'month', 'USD', 'UTC')).toThrow();
  },
);
it.each(['none', 'month'] as const)(
  'accepts P&L %s with exactly the backend series contract',
  (group) =>
    expect(
      parseProfitReport(profitReport(range, group), range, group, 'USD', 'UTC').data.netResult,
    ).toBe('-100.15'),
);
it('rejects monthly omission and unexpected none series', () => {
  const body = profitReport(range, 'none');
  expect(() => parseProfitReport(body, range, 'month', 'USD', 'UTC')).toThrow();
  Object.assign(body.data, { series: [] });
  expect(() => parseProfitReport(body, range, 'none', 'USD', 'UTC')).toThrow();
});
it('rejects duplicate expense categories', () => {
  const body = profitReport();
  body.data.expenseByCategory.push(body.data.expenseByCategory[0]!);
  expect(() => parseProfitReport(body, range, 'month', 'USD', 'UTC')).toThrow();
});
it('accepts backend-defined aging buckets independently of report range', () =>
  expect(
    parseAgingReport(agingReport('2025-01-01'), '2025-01-01', 'USD', 'UTC').data.buckets,
  ).toHaveLength(5));
it.each(['order', 'missing', 'duplicate', 'date', 'count', 'scale'] as const)(
  'rejects invalid aging %s',
  (kind) => {
    const body = agingReport();
    if (kind === 'order') body.data.buckets.reverse();
    if (kind === 'missing') body.data.buckets.pop();
    if (kind === 'duplicate') body.data.buckets[1]!.bucket = 'CURRENT';
    if (kind === 'date') body.meta.asOfDate = '2024-03-11';
    if (kind === 'count') body.data.buckets[0]!.invoiceCount = -1;
    if (kind === 'scale') body.data.outstanding = '500.001';
    expect(() => parseAgingReport(body, '2024-03-10', 'USD', 'UTC')).toThrow();
  },
);
it('isolates financial caches by account, tenant, dates, grouping, currency and timezone', () => {
  const base = financialKeys.cash('user', 'org', 'USD', 'UTC', range, 'month');
  for (const other of [
    financialKeys.cash('other', 'org', 'USD', 'UTC', range, 'month'),
    financialKeys.cash('user', 'other', 'USD', 'UTC', range, 'month'),
    financialKeys.cash('user', 'org', 'JPY', 'UTC', range, 'month'),
    financialKeys.cash('user', 'org', 'USD', 'Asia/Kolkata', range, 'month'),
    financialKeys.cash('user', 'org', 'USD', 'UTC', range, 'week'),
    financialKeys.cash('user', 'org', 'USD', 'UTC', { ...range, toDate: '2024-03-11' }, 'month'),
  ])
    expect(other).not.toEqual(base);
});
it('invalidates selected reporting scopes without affecting other tenants, accounts or aging', () => {
  const client = new QueryClient();
  for (const account of ['a', 'b'])
    for (const org of ['a', 'b'])
      for (const kind of ['dashboard', 'cash-flow', 'profit-loss', 'receivables-aging'] as const)
        client.setQueryData(financialKeys.scope(account, org, kind), {});
  invalidateFinancialReads(client, 'a', 'a', ['dashboard', 'cash-flow', 'profit-loss']);
  for (const query of client.getQueryCache().getAll())
    expect(query.state.isInvalidated).toBe(
      query.queryKey[1] === 'a' &&
        query.queryKey[2] === 'a' &&
        query.queryKey[3] !== 'receivables-aging',
    );
  client.clear();
});
