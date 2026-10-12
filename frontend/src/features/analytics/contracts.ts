import { z } from 'zod';
import {
  dateSchema,
  nonnegativeSchema,
  verifyAmounts,
  invalidFinancial,
} from '../financials/contracts';
export const agingBuckets = ['CURRENT', '1_30', '31_60', '61_90', '91_PLUS'] as const;
export const agingLabels = {
  CURRENT: 'Current (due today or later)',
  '1_30': '1–30 days overdue',
  '31_60': '31–60 days overdue',
  '61_90': '61–90 days overdue',
  '91_PLUS': '91+ days overdue',
};
const agingSchema = z.object({
  data: z.object({
    outstanding: nonnegativeSchema,
    overdue: nonnegativeSchema,
    buckets: z
      .array(
        z.object({
          bucket: z.enum(agingBuckets),
          invoiceCount: z.number().int().nonnegative(),
          amount: nonnegativeSchema,
        }),
      )
      .length(5),
  }),
  meta: z.object({
    asOfDate: dateSchema,
    currency: z.string(),
    timezone: z.string(),
    basis: z.literal('CURRENT_STATE'),
    receivablesBasis: z.literal(
      'CURRENT_ISSUED_ISSUE_DATE_THROUGH_AS_OF_RECORDED_PAYMENTS_THROUGH_AS_OF',
    ),
  }),
});
export type AgingReport = z.infer<typeof agingSchema>;
export function parseAgingReport(
  body: unknown,
  asOfDate: string,
  currency: string,
  timezone: string,
): AgingReport {
  const result = agingSchema.safeParse(body);
  if (!result.success) return invalidFinancial();
  const report = result.data;
  if (
    report.meta.asOfDate !== asOfDate ||
    report.meta.currency !== currency ||
    report.meta.timezone !== timezone ||
    report.data.buckets.some((row, index) => row.bucket !== agingBuckets[index])
  )
    return invalidFinancial();
  verifyAmounts(
    [report.data.outstanding, report.data.overdue, ...report.data.buckets.map((row) => row.amount)],
    currency,
  );
  return report;
}
