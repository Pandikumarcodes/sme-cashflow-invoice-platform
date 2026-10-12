import { z } from 'zod';
import { ApiError } from '../../api/errors';
import { organizationIdPattern } from '../../organizations/contracts';
import { dateSchema } from '../invoices/contracts';
import { currencyScale, InvoiceDecimal, moneyPattern } from '../invoices/calculation';

const uuid = z.string().regex(organizationIdPattern);
const instant = z.iso.datetime({ offset: true });
const decimal = z.string().regex(moneyPattern);
export const methods = [
  'CASH',
  'BANK_TRANSFER',
  'UPI',
  'CHEQUE',
  'CARD_EXTERNAL',
  'OTHER',
] as const;
export const recordSchema = z
  .object({ amount: decimal, paymentDate: dateSchema, method: z.enum(methods) })
  .strict();
export type RecordInput = z.infer<typeof recordSchema>;
export function recordFormSchema(currency: string, balance: string) {
  return recordSchema.superRefine((value, ctx) => {
    const amount = new InvoiceDecimal(value.amount);
    if (!amount.gt('0') || amount.decimalPlaces() > currencyScale(currency))
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: `Enter a positive amount with at most ${currencyScale(currency)} decimal places.`,
      });
    else if (amount.gt(balance))
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Amount exceeds the current invoice balance. Reload to check settlement.',
      });
  });
}
export const reversalSchema = z
  .object({
    reason: z
      .string()
      .refine(
        (value) => /\S/.test(value) && value.length <= 500,
        'Enter a visible reason of at most 500 characters.',
      ),
    reversalDate: dateSchema,
  })
  .strict();
export type ReversalInput = z.infer<typeof reversalSchema>;
const paymentSchema = z.object({
  id: uuid,
  organizationId: uuid,
  invoiceId: uuid,
  amount: decimal,
  currency: z.string().regex(/^[A-Z]{3}$/),
  paymentDate: dateSchema,
  method: z.enum(methods),
  status: z.enum(['RECORDED', 'REVERSED']),
  createdByUserId: uuid,
  recordedAt: instant,
  reversedAt: instant.nullable(),
  createdAt: instant,
  updatedAt: instant,
  reversal: z
    .object({
      id: uuid,
      paymentId: uuid,
      amount: decimal,
      reason: z.string().min(1).max(500),
      reversalDate: dateSchema,
      reversedByUserId: uuid,
      createdAt: instant,
    })
    .nullable(),
  invoice: z.object({
    id: uuid,
    invoiceNumber: z.string().min(1).max(40).nullable(),
    status: z.enum(['DRAFT', 'ISSUED', 'CANCELLED', 'VOID']),
    paymentState: z.enum(['NOT_APPLICABLE', 'UNPAID', 'PARTIALLY_PAID', 'PAID']),
    amountPaid: decimal,
    balanceDue: decimal,
    version: z.number().int().positive(),
  }),
});
export type Payment = z.infer<typeof paymentSchema>;
export function invalidPayment(): never {
  throw new ApiError(
    'The service returned an unexpected payment response.',
    'INVALID_RESPONSE',
    undefined,
    'invalid-response',
  );
}
export function validatePayment(
  value: unknown,
  org: string,
  currency: string,
  id?: string,
  invoiceId?: string,
): Payment {
  const parsed = paymentSchema.safeParse(value);
  if (!parsed.success) return invalidPayment();
  const p = parsed.data;
  const fixed = new RegExp(
    `^(?:0|[1-9]\\d{0,14})${currencyScale(currency) ? `\\.\\d{${currencyScale(currency)}}` : ''}$`,
  );
  if (
    p.organizationId !== org ||
    p.currency !== currency ||
    (id && p.id !== id) ||
    p.invoice.id !== p.invoiceId ||
    (invoiceId && p.invoiceId !== invoiceId) ||
    ![
      p.amount,
      p.invoice.amountPaid,
      p.invoice.balanceDue,
      ...(p.reversal ? [p.reversal.amount] : []),
    ].every((amount) => fixed.test(amount)) ||
    !new InvoiceDecimal(p.amount).gt('0') ||
    (p.status === 'RECORDED'
      ? p.reversal !== null || p.reversedAt !== null
      : !p.reversal || !p.reversedAt) ||
    (p.reversal &&
      (p.reversal.paymentId !== p.id || !new InvoiceDecimal(p.reversal.amount).eq(p.amount))) ||
    (p.invoice.status === 'ISSUED'
      ? p.invoice.paymentState !==
        (new InvoiceDecimal(p.invoice.balanceDue).isZero()
          ? 'PAID'
          : new InvoiceDecimal(p.invoice.amountPaid).isZero()
            ? 'UNPAID'
            : 'PARTIALLY_PAID')
      : p.invoice.paymentState !== 'NOT_APPLICABLE')
  )
    return invalidPayment();
  return p;
}
export function parsePayment(
  body: unknown,
  org: string,
  currency: string,
  id?: string,
  invoiceId?: string,
) {
  const envelope = z.object({ data: z.unknown() }).safeParse(body);
  if (!envelope.success) return invalidPayment();
  return validatePayment(envelope.data.data, org, currency, id, invoiceId);
}
export const defaultFilters = {
  invoiceId: '',
  status: '',
  method: '',
  paymentDateFrom: '',
  paymentDateTo: '',
  sortBy: 'paymentDate',
  sortOrder: 'desc',
  limit: 25,
};
export type PaymentFilters = typeof defaultFilters;
export function validFilters(filters: PaymentFilters) {
  const { paymentDateFrom: from, paymentDateTo: to } = filters;
  return (
    (!filters.invoiceId || organizationIdPattern.test(filters.invoiceId)) &&
    (!from || dateSchema.safeParse(from).success) &&
    (!to || dateSchema.safeParse(to).success) &&
    (!from || !to || (from <= to && (Date.parse(to) - Date.parse(from)) / 86400000 <= 1825))
  );
}
export function parsePaymentList(
  body: unknown,
  org: string,
  currency: string,
  filters: PaymentFilters,
) {
  const result = z
    .object({
      data: z.array(z.unknown()),
      meta: z.object({
        limit: z.number().int().min(1).max(100),
        hasMore: z.boolean(),
        nextCursor: z
          .string()
          .min(1)
          .max(2048)
          .regex(/^[A-Za-z0-9_-]+$/)
          .nullable(),
      }),
    })
    .safeParse(body);
  if (!result.success) return invalidPayment();
  const data = result.data.data.map((row) =>
    validatePayment(row, org, currency, undefined, filters.invoiceId || undefined),
  );
  const { meta } = result.data;
  if (
    meta.limit !== filters.limit ||
    data.length > meta.limit ||
    meta.hasMore !== (meta.nextCursor !== null) ||
    (meta.hasMore && !data.length) ||
    new Set(data.map((p) => p.id)).size !== data.length ||
    data.some(
      (p) =>
        (filters.status && p.status !== filters.status) ||
        (filters.method && p.method !== filters.method) ||
        (filters.paymentDateFrom && p.paymentDate < filters.paymentDateFrom) ||
        (filters.paymentDateTo && p.paymentDate > filters.paymentDateTo),
    )
  )
    return invalidPayment();
  return { data, meta };
}
