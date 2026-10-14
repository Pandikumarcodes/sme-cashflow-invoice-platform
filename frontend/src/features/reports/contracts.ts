import { z } from 'zod';
import { ApiError } from '../../api/errors';
import { calendarDate, localToday, presetRange } from '../dashboard/dates';
import { reportRangeError, verifyAmounts } from '../financials/contracts';
export const reportTypes = [
  'INVOICE_REGISTER',
  'PAYMENT_REGISTER',
  'EXPENSE_REGISTER',
  'RECEIVABLES',
  'CASH_FLOW',
  'CASH_BASIS_PERFORMANCE',
] as const;
export type ReportType = (typeof reportTypes)[number];
export const exportStatuses = ['PENDING', 'RUNNING', 'READY', 'FAILED', 'EXPIRED'] as const;
export const uuid = z.uuid();
export const date = z
  .string()
  .refine((value) => !!calendarDate(value), 'Enter a real calendar date.');
const optionalDate = date.optional();
const dates = { fromDate: optionalDate, toDate: optionalDate };
export const parameterSchemas = {
  INVOICE_REGISTER: z
    .object({
      ...dates,
      asOfDate: optionalDate,
      customerId: uuid.optional(),
      status: z.enum(['DRAFT', 'ISSUED', 'CANCELLED', 'VOID']).optional(),
    })
    .strict(),
  PAYMENT_REGISTER: z.object({ ...dates, invoiceId: uuid.optional() }).strict(),
  EXPENSE_REGISTER: z
    .object({
      ...dates,
      expenseCategoryId: uuid.optional(),
      vendorPayee: z.string().min(1).max(200).optional(),
    })
    .strict(),
  RECEIVABLES: z.object({ asOfDate: optionalDate }).strict(),
  CASH_FLOW: z.object({ ...dates, groupBy: z.enum(['day', 'week', 'month']).optional() }).strict(),
  CASH_BASIS_PERFORMANCE: z
    .object({ ...dates, groupBy: z.enum(['none', 'month']).optional() })
    .strict(),
};
export type ReportParameters = Record<string, string>;
export type ReportRequest = { reportType: ReportType; format: 'CSV'; parameters: ReportParameters };
export function parameterError(type: ReportType, parameters: ReportParameters) {
  const result = parameterSchemas[type].safeParse(parameters);
  if (!result.success) return 'Check report dates, identifiers and supported filters.';
  if (type !== 'RECEIVABLES') {
    const error = reportRangeError(parameters.fromDate ?? '', parameters.toDate ?? '');
    if (error) return error;
    if (
      type === 'INVOICE_REGISTER' &&
      (!parameters.asOfDate || parameters.asOfDate < parameters.fromDate!)
    )
      return 'Invoice as-of date must be on or after the range start.';
  } else if (!parameters.asOfDate) return 'Enter an as-of date.';
}
const instant = z.iso.datetime({ offset: true });
const exportSchema = z.object({
  id: uuid,
  organizationId: uuid,
  reportType: z.enum(reportTypes),
  format: z.literal('CSV'),
  parameters: z.record(z.string(), z.string()),
  status: z.enum(exportStatuses),
  rowCount: z
    .string()
    .regex(/^(?:0|[1-9]\d*)$/)
    .nullable(),
  errorCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,99}$/)
    .nullable(),
  completedAt: instant.nullable(),
  expiresAt: instant.nullable(),
  createdAt: instant,
  updatedAt: instant,
});
export type ReportExport = z.infer<typeof exportSchema>;
export type ExportFilters = {
  limit: 25 | 50 | 100;
  reportType: ReportType | '';
  status: (typeof exportStatuses)[number] | '';
};
export const defaultExportFilters: ExportFilters = { limit: 25, reportType: '', status: '' };
export const pageMeta = z.object({
  limit: z.number().int().min(1).max(100),
  hasMore: z.boolean(),
  nextCursor: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .nullable(),
});
export function invalidReport(): never {
  throw new ApiError(
    'The report response could not be verified.',
    'INVALID_RESPONSE',
    undefined,
    'invalid-response',
  );
}
function verifyExport(row: ReportExport, org: string) {
  if (
    row.organizationId !== org ||
    !parameterSchemas[row.reportType].safeParse(row.parameters).success ||
    (row.status !== 'FAILED' && row.errorCode !== null) ||
    (['READY', 'EXPIRED'].includes(row.status) &&
      (row.completedAt === null || row.expiresAt === null || row.rowCount === null))
  )
    return invalidReport();
  return row;
}
export function parseExport(body: unknown, org: string, id?: string) {
  const result = z.object({ data: exportSchema }).safeParse(body);
  if (!result.success || (id && result.data.data.id !== id)) return invalidReport();
  return verifyExport(result.data.data, org);
}
export function parseExports(body: unknown, org: string, filters: ExportFilters) {
  const result = z.object({ data: z.array(exportSchema).max(100), meta: pageMeta }).safeParse(body);
  if (!result.success) return invalidReport();
  const page = result.data;
  if (
    page.meta.limit !== filters.limit ||
    page.data.length > filters.limit ||
    page.meta.hasMore !== (page.meta.nextCursor !== null) ||
    new Set(page.data.map((row) => row.id)).size !== page.data.length
  )
    return invalidReport();
  for (const row of page.data) {
    verifyExport(row, org);
    if (
      (filters.reportType && row.reportType !== filters.reportType) ||
      (filters.status && row.status !== filters.status)
    )
      return invalidReport();
  }
  return page;
}
export type PreviewType =
  'INVOICE_REGISTER' | 'PAYMENT_REGISTER' | 'EXPENSE_REGISTER' | 'RECEIVABLES';
const amount = z.string().regex(/^(?:0|[1-9]\d{0,63})(?:\.\d{1,4})?$/);
const nullableText = z.string().nullable();
const previewSchemas = {
  INVOICE_REGISTER: z.object({
    id: uuid,
    invoiceNumber: nullableText,
    status: z.enum(['DRAFT', 'ISSUED', 'CANCELLED', 'VOID']),
    customerId: uuid,
    customerName: z.string(),
    issueDate: date,
    dueDate: date,
    currency: z.string(),
    total: amount,
    paid: amount,
    balance: amount,
    overdue: z.boolean(),
  }),
  PAYMENT_REGISTER: z.object({
    id: uuid,
    invoiceId: uuid,
    invoiceNumber: nullableText,
    customerName: z.string(),
    paymentDate: date,
    paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER']),
    currency: z.string(),
    amount,
  }),
  EXPENSE_REGISTER: z.object({
    id: uuid,
    expenseDate: date,
    categoryId: uuid,
    categoryName: z.string(),
    vendorPayee: nullableText,
    description: z.string(),
    currency: z.string(),
    amount,
  }),
  RECEIVABLES: z.object({
    bucket: z.enum(['CURRENT', '1_30', '31_60', '61_90', '91_PLUS']),
    invoiceCount: z.number().int().nonnegative(),
    amount,
    currency: z.string(),
    asOfDate: date,
  }),
};
export type PreviewRow = z.infer<(typeof previewSchemas)[PreviewType]>;
export function parsePreview(
  body: unknown,
  type: PreviewType,
  parameters: ReportParameters,
  currency: string,
  timezone: string,
  limit: number,
) {
  const result = z
    .object({
      data: z.array(previewSchemas[type]).max(100),
      meta: pageMeta
        .extend({
          currency: z.literal(currency),
          timezone: z.literal(timezone),
          basis: z.literal('CURRENT_STATE'),
        })
        .passthrough(),
    })
    .safeParse(body);
  if (!result.success) return invalidReport();
  const page = result.data;
  if (
    page.meta.limit !== limit ||
    page.data.length > limit ||
    page.meta.hasMore !== (page.meta.nextCursor !== null) ||
    Object.entries(parameters).some(([key, value]) => page.meta[key] !== value)
  )
    return invalidReport();
  for (const row of page.data) {
    if (row.currency !== currency) return invalidReport();
    verifyAmounts('total' in row ? [row.total, row.paid, row.balance] : [row.amount], currency);
  }
  return page;
}

export function defaultParameters(type: ReportType, timezone: string): ReportParameters {
  const range = presetRange('current-month', localToday(timezone));
  return type === 'RECEIVABLES'
    ? { asOfDate: range.asOfDate }
    : {
        fromDate: range.fromDate,
        toDate: range.toDate,
        ...(type === 'INVOICE_REGISTER' ? { asOfDate: range.asOfDate } : {}),
        ...(['CASH_FLOW', 'CASH_BASIS_PERFORMANCE'].includes(type) ? { groupBy: 'month' } : {}),
      };
}

export const reportLabels: Record<ReportType, string> = {
  INVOICE_REGISTER: 'Invoice register',
  PAYMENT_REGISTER: 'Recorded payments',
  EXPENSE_REGISTER: 'Active expenses',
  RECEIVABLES: 'Receivables aging',
  CASH_FLOW: 'Cash Flow',
  CASH_BASIS_PERFORMANCE: 'Simplified cash-basis performance',
};
