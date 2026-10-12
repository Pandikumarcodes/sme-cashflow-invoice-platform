import { z } from 'zod';
import { ApiError } from '../../api/errors';
import { calendarDate, type DateRange } from './dates';
const amount = z.string().regex(/^-?(?:0|[1-9]\d{0,63})(?:\.\d{1,4})?$/);
const nonnegative = amount.refine((value) => !value.startsWith('-'));
const count = z.number().int().nonnegative();
const date = z.string().refine((value) => !!calendarDate(value));
const meta = z.object({ fromDate: date, toDate: date, currency: z.string(), timezone: z.string() });
const summarySchema = z.object({
  data: z.object({
    billing: z.object({
      totalInvoiced: nonnegative,
      invoiceCounts: z.object({ DRAFT: count, ISSUED: count, CANCELLED: count, VOID: count }),
    }),
    collections: z.object({
      collected: nonnegative,
      rate: amount.nullable(),
      averagePaymentDelayDays: amount.nullable(),
      sampleSize: count,
    }),
    receivables: z.object({ outstanding: nonnegative, overdue: nonnegative }),
    spending: z.object({ expenses: nonnegative }),
    cash: z.object({ netCashFlow: amount, netResult: amount }),
    customers: z.object({ activeCount: count }),
  }),
  meta: meta.extend({
    asOfDate: date,
    basis: z.literal('CURRENT_STATE'),
    receivablesBasis: z.literal(
      'CURRENT_ISSUED_ISSUE_DATE_THROUGH_AS_OF_RECORDED_PAYMENTS_THROUGH_AS_OF',
    ),
    collectionRateBasis: z.literal(
      'CURRENT_ISSUED_IN_ISSUE_DATE_RANGE_RECORDED_PAYMENTS_THROUGH_AS_OF',
    ),
    collectionRateUnit: z.literal('PERCENT'),
    paymentDelayBasis: z.literal('FULLY_PAID_COHORT_FINAL_PAYMENT_DATE_MINUS_DUE_DATE'),
    cashBasis: z.literal('PAYMENT_DATE_AND_EXPENSE_DATE_IN_RANGE'),
    customerCountBasis: z.literal('CURRENT_ACTIVE'),
  }),
});
export const cashSchema = z.object({
  data: z.object({
    inflows: nonnegative,
    outflows: nonnegative,
    netCashFlow: amount,
    series: z.array(
      z.object({
        periodStart: date,
        inflows: nonnegative,
        outflows: nonnegative,
        netCashFlow: amount,
      }),
    ),
  }),
  meta: meta.extend({ groupBy: z.literal('month'), basis: z.literal('cash') }),
});
export type Summary = z.infer<typeof summarySchema>;
export type CashFlow = z.infer<typeof cashSchema>;
// Independently validated summary reads retain the Dashboard's existing key.
export function parseDashboardSummary(
  body: unknown,
  range: DateRange,
  currency: string,
  timezone: string,
): Summary {
  const parsed = summarySchema.safeParse(body);
  if (
    !parsed.success ||
    parsed.data.meta.fromDate !== range.fromDate ||
    parsed.data.meta.toDate !== range.toDate ||
    parsed.data.meta.asOfDate !== range.asOfDate ||
    parsed.data.meta.currency !== currency ||
    parsed.data.meta.timezone !== timezone
  )
    return invalid();
  const scale =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const data = parsed.data.data;
  const values = [
    data.billing.totalInvoiced,
    data.collections.collected,
    data.receivables.outstanding,
    data.receivables.overdue,
    data.spending.expenses,
    data.cash.netCashFlow,
    data.cash.netResult,
  ];
  if (scale > 4 || values.some((value) => (value.split('.')[1]?.length ?? 0) !== scale))
    return invalid();
  return parsed.data;
}
function invalid(): never {
  throw new ApiError(
    'The financial overview could not be verified.',
    'INVALID_RESPONSE',
    undefined,
    'invalid-response',
  );
}
export function parseDashboard(
  summary: unknown,
  cash: unknown,
  range: DateRange,
  currency: string,
  timezone: string,
) {
  const s = summarySchema.safeParse(summary);
  const c = cashSchema.safeParse(cash);
  if (
    !s.success ||
    !c.success ||
    s.data.meta.asOfDate !== range.asOfDate ||
    [s.data.meta, c.data.meta].some(
      (m) =>
        m.fromDate !== range.fromDate ||
        m.toDate !== range.toDate ||
        m.currency !== currency ||
        m.timezone !== timezone,
    )
  ) {
    return invalid();
  }
  const scale =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const totals = s.data.data;
  const cashData = c.data.data;
  const monetaryValues = [
    totals.billing.totalInvoiced,
    totals.collections.collected,
    totals.receivables.outstanding,
    totals.receivables.overdue,
    totals.spending.expenses,
    totals.cash.netCashFlow,
    totals.cash.netResult,
    cashData.inflows,
    cashData.outflows,
    cashData.netCashFlow,
    ...cashData.series.flatMap((period) => [period.inflows, period.outflows, period.netCashFlow]),
  ];
  if (scale > 4 || monetaryValues.some((value) => (value.split('.')[1]?.length ?? 0) !== scale))
    return invalid();
  if (
    cashData.series.some(
      (period, index) =>
        !period.periodStart.endsWith('-01') ||
        period.periodStart < `${range.fromDate.slice(0, 7)}-01` ||
        period.periodStart > range.toDate ||
        (index > 0 && period.periodStart <= cashData.series[index - 1]!.periodStart),
    )
  )
    return invalid();
  return { summary: s.data, cash: c.data };
}
