import { z } from 'zod';
import { ApiError } from '../../api/errors';
import { organizationIdPattern } from '../../organizations/contracts';
import { calendarDate } from '../dashboard/dates';
import { cashSchema } from '../dashboard/contracts';
export type Period = { fromDate: string; toDate: string };
export type CashGrouping = 'day' | 'week' | 'month';
export type ProfitGrouping = 'none' | 'month';
export const amountSchema = z.string().regex(/^-?(?:0|[1-9]\d{0,63})(?:\.\d{1,4})?$/);
export const nonnegativeSchema = amountSchema.refine((value) => !value.startsWith('-'));
export const dateSchema = z.string().refine((value) => !!calendarDate(value));
export const reportMetaSchema = z.object({
  fromDate: dateSchema,
  toDate: dateSchema,
  currency: z.string(),
  timezone: z.string(),
});
const cashReportSchema = cashSchema.extend({
  meta: reportMetaSchema.extend({
    groupBy: z.enum(['day', 'week', 'month']),
    basis: z.literal('cash'),
  }),
});
export type CashReport = z.infer<typeof cashReportSchema>;
const profitReportSchema = z.object({
  data: z.object({
    revenue: nonnegativeSchema,
    expenses: nonnegativeSchema,
    netResult: amountSchema,
    expenseByCategory: z.array(
      z.object({
        categoryId: z.string().regex(organizationIdPattern),
        categoryName: z.string().refine((value) => !!value.trim() && value.length <= 100),
        amount: nonnegativeSchema,
      }),
    ),
    series: z
      .array(
        z.object({
          periodStart: dateSchema,
          revenue: nonnegativeSchema,
          expenses: nonnegativeSchema,
          netResult: amountSchema,
        }),
      )
      .optional(),
  }),
  meta: reportMetaSchema.extend({
    groupBy: z.enum(['none', 'month']),
    basis: z.literal('SIMPLIFIED_CASH'),
    disclaimer: z.literal('Not a GAAP/IFRS financial statement.'),
  }),
});
export type ProfitReport = z.infer<typeof profitReportSchema>;
export function invalidFinancial(): never {
  throw new ApiError(
    'The financial response could not be verified.',
    'INVALID_RESPONSE',
    undefined,
    'invalid-response',
  );
}
export function reportRangeError(from: string, to: string) {
  const start = calendarDate(from),
    end = calendarDate(to);
  if (!start || !end) return 'Enter valid calendar dates.';
  const days = (end.getTime() - start.getTime()) / 86400000 + 1;
  return days < 1 || days > 366
    ? 'Choose an ordered range of at most 366 inclusive days.'
    : undefined;
}
export function periodFloor(value: string, group: CashGrouping) {
  const date = calendarDate(value)!;
  if (group === 'month') date.setUTCDate(1);
  if (group === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
export function verifyAmounts(values: string[], currency: string) {
  const scale =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  if (scale > 4 || values.some((value) => (value.split('.')[1]?.length ?? 0) !== scale))
    return invalidFinancial();
}
function verifyMeta(
  meta: { fromDate: string; toDate: string; currency: string; timezone: string },
  range: Period,
  currency: string,
  timezone: string,
) {
  if (
    meta.fromDate !== range.fromDate ||
    meta.toDate !== range.toDate ||
    meta.currency !== currency ||
    meta.timezone !== timezone
  )
    return invalidFinancial();
}
function verifySeries(rows: { periodStart: string }[], range: Period, group: CashGrouping) {
  const first = periodFloor(range.fromDate, group);
  if (
    rows.some(
      (row, index) =>
        row.periodStart < first ||
        row.periodStart > range.toDate ||
        row.periodStart !== periodFloor(row.periodStart, group) ||
        (index > 0 && row.periodStart <= rows[index - 1]!.periodStart),
    )
  )
    return invalidFinancial();
}
export function parseCashReport(
  body: unknown,
  range: Period,
  group: CashGrouping,
  currency: string,
  timezone: string,
): CashReport {
  const result = cashReportSchema.safeParse(body);
  if (!result.success) return invalidFinancial();
  const report = result.data;
  verifyMeta(report.meta, range, currency, timezone);
  if (report.meta.groupBy !== group) return invalidFinancial();
  verifyAmounts(
    [
      report.data.inflows,
      report.data.outflows,
      report.data.netCashFlow,
      ...report.data.series.flatMap((row) => [row.inflows, row.outflows, row.netCashFlow]),
    ],
    currency,
  );
  verifySeries(report.data.series, range, group);
  return report;
}
export function parseProfitReport(
  body: unknown,
  range: Period,
  group: ProfitGrouping,
  currency: string,
  timezone: string,
): ProfitReport {
  const result = profitReportSchema.safeParse(body);
  if (!result.success) return invalidFinancial();
  const report = result.data;
  verifyMeta(report.meta, range, currency, timezone);
  if (
    report.meta.groupBy !== group ||
    (group === 'none' ? report.data.series !== undefined : report.data.series === undefined) ||
    new Set(report.data.expenseByCategory.map((row) => row.categoryId)).size !==
      report.data.expenseByCategory.length
  )
    return invalidFinancial();
  verifyAmounts(
    [
      report.data.revenue,
      report.data.expenses,
      report.data.netResult,
      ...report.data.expenseByCategory.map((row) => row.amount),
      ...(report.data.series ?? []).flatMap((row) => [row.revenue, row.expenses, row.netResult]),
    ],
    currency,
  );
  if (report.data.series) verifySeries(report.data.series, range, 'month');
  return report;
}
