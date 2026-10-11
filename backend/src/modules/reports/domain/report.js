import { createHash } from 'node:crypto';
import { ReportType, ExportStatus } from '@prisma/client';
import { z } from 'zod';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { cashFlowOptions } from '../../financial/domain/cash-flow.js';
import { profitLossOptions } from '../../financial/domain/profit-loss.js';
import { analyticsOptions } from '../../financial/domain/analytics.js';

export const REPORT_EVENT = 'REPORT_EXPORT_REQUESTED';
export const JOB_SCHEMA = z
  .object({ version: z.literal(1), organizationId: z.uuid(), eventId: z.uuid() })
  .strict();
export const EVENT_SCHEMA = z
  .object({ version: z.literal(1), organizationId: z.uuid(), exportId: z.uuid() })
  .strict();
const dates = { fromDate: z.string().optional(), toDate: z.string().optional() };
const parameters = {
  INVOICE_REGISTER: z
    .object({
      ...dates,
      asOfDate: z.string().optional(),
      customerId: z.uuid().optional(),
      status: z.enum(['DRAFT', 'ISSUED', 'CANCELLED', 'VOID']).optional(),
    })
    .strict(),
  RECEIVABLES: z.object({ asOfDate: z.string().optional() }).strict(),
  PAYMENT_REGISTER: z.object({ ...dates, invoiceId: z.uuid().optional() }).strict(),
  EXPENSE_REGISTER: z
    .object({
      ...dates,
      expenseCategoryId: z.uuid().optional(),
      vendorPayee: z.string().min(1).max(200).optional(),
    })
    .strict(),
  CASH_FLOW: z.object({ ...dates, groupBy: z.enum(['day', 'week', 'month']).optional() }).strict(),
  CASH_BASIS_PERFORMANCE: z
    .object({ ...dates, groupBy: z.enum(['none', 'month']).optional() })
    .strict(),
};
export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Invalid report input.');
  return result.data;
}
export function reportOptions(type, input, organization) {
  if (!parameters[type])
    throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Unsupported report type.');
  const value = parse(parameters[type], input);
  if (type === 'RECEIVABLES') return analyticsOptions(value, organization.timezone, false);
  if (type === 'CASH_BASIS_PERFORMANCE') return profitLossOptions(value, organization.timezone);
  if (type === 'CASH_FLOW') return cashFlowOptions(value, organization.timezone);
  const range =
    type === 'INVOICE_REGISTER'
      ? analyticsOptions(value, organization.timezone)
      : cashFlowOptions(value, organization.timezone);
  const normalized = { ...range };
  delete normalized.groupBy;
  return { ...value, ...normalized };
}
export const REQUEST_SCHEMA = z
  .object({
    reportType: z.enum(ReportType),
    format: z.literal('CSV'),
    parameters: z.record(z.string(), z.unknown()),
  })
  .strict();
export const PAGE_SCHEMA = z
  .object({
    limit: z
      .string()
      .regex(/^(?:[1-9]\d?|100)$/)
      .optional(),
    after: z.string().min(1).max(2048).optional(),
  })
  .strict();
export const LIST_SCHEMA = PAGE_SCHEMA.extend({
  status: z.enum(ExportStatus).optional(),
  reportType: z.enum(ReportType).optional(),
});
export function cursorScope(organizationId, kind, filters) {
  return createHash('sha256')
    .update(JSON.stringify({ organizationId, kind, filters }))
    .digest('hex');
}
export function encodeCursor(row, signature, field = 'id') {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      signature,
      id: row.id,
      ...(field === 'createdAt' ? { createdAt: row.createdAt.toISOString() } : {}),
    }),
  ).toString('base64url');
}
export function decodeCursor(cursor, signature, dated = false, aging = false) {
  if (cursor === undefined) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > 2048) throw new Error();
    const buffer = Buffer.from(cursor, 'base64url');
    if (buffer.toString('base64url') !== cursor) throw new Error();
    const schema = z
      .object({
        v: z.literal(1),
        signature: z.literal(signature),
        id: aging ? z.enum(['CURRENT', '1_30', '31_60', '61_90', '91_PLUS']) : z.uuid(),
        ...(dated ? { createdAt: z.iso.datetime() } : {}),
      })
      .strict();
    return schema.parse(JSON.parse(buffer.toString('utf8')));
  } catch {
    throw new ApplicationError(ERROR_CODES.INVALID_CURSOR, 'Invalid report cursor.');
  }
}
export function exportResponse(row, now = new Date()) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    reportType: row.reportType,
    format: row.format,
    parameters: row.parameters,
    status:
      row.status === 'READY' && row.expiresAt && row.expiresAt <= now ? 'EXPIRED' : row.status,
    rowCount: row.rowCount?.toString() ?? null,
    errorCode: row.status === 'FAILED' ? row.errorCode : null,
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
