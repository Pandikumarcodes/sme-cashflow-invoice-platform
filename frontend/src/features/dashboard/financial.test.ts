import { expect, it } from 'vitest';
import { chartPoints, formatMoney } from './money';
import { calendarDate, localToday, presetRange, rangeError } from './dates';
import { parseDashboard } from './contracts';
import { cashFixture, summaryFixture } from './test-fixtures';
const range = presetRange('current-month', '2026-10-11');
it('formats aggregate money beyond Number precision exactly', () => {
  expect(formatMoney('9007199254740993.01', 'USD')).toBe('$9,007,199,254,740,993.01');
  expect(formatMoney('-0.01', 'USD')).toBe('-$0.01');
  expect(formatMoney('1234567890123456', 'JPY')).toBe('¥1,234,567,890,123,456');
  expect(formatMoney('1.234', 'KWD')).toContain('1.234');
});
it('normalizes chart coordinates without altering exact source strings or filling gaps', () => {
  const result = chartPoints([
    {
      periodStart: '2026-01-01',
      inflows: '9007199254740993.01',
      outflows: '4503599627370496.505',
      netCashFlow: '4503599627370496.505',
    },
  ]);
  expect(result.points).toHaveLength(1);
  expect(result.points[0]?.incoming).toBe(1);
  expect(result.points[0]?.outgoing).toBe(0.5);
  expect(result.points[0]?.inflows).toBe('9007199254740993.01');
});
it('handles zero and absent chart activity', () => {
  expect(chartPoints([]).points).toEqual([]);
  expect(
    chartPoints([
      { periodStart: '2026-01-01', inflows: '0.00', outflows: '0.00', netCashFlow: '0.00' },
    ]).points[0]?.incoming,
  ).toBe(0);
});
it('uses organization-local dates rather than server or browser timezone', () => {
  const now = new Date('2026-03-01T00:30:00Z');
  expect(localToday('America/Los_Angeles', now)).toBe('2026-02-28');
  expect(localToday('Asia/Kolkata', now)).toBe('2026-03-01');
});
it('computes inclusive calendar presets over leap days and year boundaries', () => {
  expect(presetRange('previous-month', '2024-03-01')).toEqual({
    fromDate: '2024-02-01',
    toDate: '2024-02-29',
    asOfDate: '2024-03-01',
  });
  expect(presetRange('previous-month', '2026-01-01').fromDate).toBe('2025-12-01');
  expect(presetRange('last-90-days', '2024-03-01').fromDate).toBe('2023-12-03');
});
it('enforces real dates, ordered bounds, 366 inclusive days and as-of constraints', () => {
  expect(calendarDate('2026-02-30')).toBeUndefined();
  expect(calendarDate('0000-01-01')).toBeUndefined();
  expect(rangeError('2024-01-01', '2024-12-31', '2025-01-01')).toBeUndefined();
  expect(rangeError('2024-01-01', '2025-01-01', '2025-01-01')).toContain('366');
  expect(rangeError('2026-10-12', '2026-10-13', '2026-10-11')).toContain('as-of');
  expect(rangeError('2026-10-11', '2026-10-01', '2026-10-11')).toContain('ordered');
});
it('preserves backend decimal strings and definitions', () => {
  const data = parseDashboard(summaryFixture(range), cashFixture(range), range, 'USD', 'UTC');
  expect(data.summary.data.collections.collected).toBe('1200.10');
  expect(data.summary.data.collections.averagePaymentDelayDays).toBe('-2.00');
});
it.each(['currency', 'timezone', 'fromDate', 'asOfDate'])(
  'rejects mismatched summary context %s',
  (field) => {
    const summary = summaryFixture(range);
    expect(() =>
      parseDashboard(
        { ...summary, meta: { ...summary.meta, [field]: 'incorrect' } },
        cashFixture(range),
        range,
        'USD',
        'UTC',
      ),
    ).toThrow('could not be verified');
  },
);
it('rejects numeric monetary responses and incompatible cash basis', () => {
  const summary = summaryFixture(range);
  const cash = cashFixture(range);
  expect(() =>
    parseDashboard(
      { ...summary, data: { ...summary.data, spending: { expenses: 12.5 } } },
      cash,
      range,
      'USD',
      'UTC',
    ),
  ).toThrow();
  expect(() =>
    parseDashboard(
      summary,
      { ...cash, meta: { ...cash.meta, basis: 'accrual' } },
      range,
      'USD',
      'UTC',
    ),
  ).toThrow();
});
it('rejects money at an incorrect currency scale instead of silently rounding it', () => {
  expect(() =>
    parseDashboard(summaryFixture(range, '1.234'), cashFixture(range), range, 'USD', 'UTC'),
  ).toThrow('could not be verified');
});
it('rejects duplicate or out-of-range chart periods', () => {
  const cash = cashFixture(range);
  cash.data.series.push(cash.data.series[0]!);
  expect(() => parseDashboard(summaryFixture(range), cash, range, 'USD', 'UTC')).toThrow();
  const outside = cashFixture(range);
  outside.data.series[0]!.periodStart = '2020-01-01';
  expect(() => parseDashboard(summaryFixture(range), outside, range, 'USD', 'UTC')).toThrow();
});
