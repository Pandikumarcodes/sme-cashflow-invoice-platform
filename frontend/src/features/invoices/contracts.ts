import { z } from 'zod';
import { ApiError } from '../../api/errors';
import { organizationIdPattern } from '../../organizations/contracts';
import {
  moneyPattern,
  quantityPattern,
  ratePattern,
  previewInvoice,
  currencyScale,
} from './calculation';
const uuid = z.string().regex(organizationIdPattern);
export const dateSchema = z
  .string()
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      value >= '0001-01-01' &&
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
    'Enter a valid YYYY-MM-DD date.',
  );
const visible = (max: number) =>
  z
    .string()
    .refine((value) => /\S/.test(value), 'Enter visible text.')
    .refine((value) => value.length <= max, `Use at most ${max} characters.`);
export const itemSchema = z
  .object({
    description: visible(500),
    quantity: z
      .string()
      .regex(quantityPattern, 'Use up to six decimal places.')
      .refine((value) => !/^0(?:\.0+)?$/.test(value), 'Quantity must be positive.'),
    unitPrice: z.string().regex(moneyPattern, 'Use up to four decimal places.'),
    sortOrder: z.number().int().min(0).max(2147483647),
  })
  .strict();
export const discountSchema = z
  .object({
    type: z.enum(['NONE', 'FIXED', 'PERCENTAGE']),
    value: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/)
      .max(22),
  })
  .strict();
export const inputSchema = z
  .object({
    customerId: uuid,
    issueDate: dateSchema,
    dueDate: dateSchema,
    discount: discountSchema,
    taxRate: z.string().regex(ratePattern, 'Use up to six decimal places.'),
    items: z.array(itemSchema).min(1, 'Add at least one item.').max(1000),
  })
  .strict();
export type InvoiceInput = z.infer<typeof inputSchema>;
export function invoiceFormSchema(currency: string) {
  return inputSchema.superRefine((value, ctx) => {
    if (value.dueDate < value.issueDate)
      ctx.addIssue({
        code: 'custom',
        path: ['dueDate'],
        message: 'Due date cannot precede invoice date.',
      });
    try {
      previewInvoice(value, currency);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: error instanceof Error ? error.message : 'Check invoice values.',
      });
    }
  });
}
export const reasonSchema = z.object({ reason: visible(500) }).strict();
const decimal = z.string().regex(moneyPattern);
const instant = z.iso.datetime({ offset: true });
export const invoiceSchema = z.object({
  id: uuid,
  organizationId: uuid,
  customerId: uuid,
  status: z.enum(['DRAFT', 'ISSUED', 'CANCELLED', 'VOID']),
  invoiceNumber: z.string().min(1).max(40).nullable(),
  sequenceValue: z
    .string()
    .regex(/^[1-9]\d*$/)
    .nullable(),
  numberPrefix: z.string().nullable(),
  customer: z.object({ id: uuid, displayName: visible(200), email: z.string().nullable() }),
  paymentState: z.enum(['NOT_APPLICABLE', 'UNPAID', 'PARTIALLY_PAID', 'PAID']),
  isOverdue: z.boolean(),
  issueDate: dateSchema,
  dueDate: dateSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  discount: discountSchema,
  taxRate: z.string().regex(ratePattern),
  items: z
    .array(itemSchema.extend({ id: uuid, lineAmount: decimal }))
    .min(1)
    .max(1000),
  subtotal: decimal,
  discountTotal: decimal,
  taxableTotal: decimal,
  taxTotal: decimal,
  total: decimal,
  amountPaid: decimal,
  balanceDue: decimal,
  createdByUserId: uuid,
  issuedByUserId: uuid.nullable(),
  issuedAt: instant.nullable(),
  cancelledAt: instant.nullable(),
  cancelReason: z.string().nullable(),
  voidedAt: instant.nullable(),
  voidReason: z.string().nullable(),
  version: z.number().int().min(1).max(2147483647),
  createdAt: instant,
  updatedAt: instant,
});
export type Invoice = z.infer<typeof invoiceSchema>;
export type InvoiceResource = { invoice: Invoice; etag: string };
export function invalidInvoice(): never {
  throw new ApiError(
    'The invoice response could not be verified.',
    'INVALID_RESPONSE',
    undefined,
    'invalid-response',
  );
}
function verified(invoice: Invoice, organizationId: string, currency: string) {
  const scale = currencyScale(currency);
  if (
    invoice.organizationId !== organizationId ||
    invoice.currency !== currency ||
    invoice.customer.id !== invoice.customerId ||
    invoice.dueDate < invoice.issueDate ||
    new Set(invoice.items.map((item) => item.sortOrder)).size !== invoice.items.length ||
    new Set(invoice.items.map((item) => item.id)).size !== invoice.items.length ||
    (invoice.status === 'DRAFT'
      ? invoice.invoiceNumber !== null || invoice.paymentState !== 'NOT_APPLICABLE'
      : !invoice.invoiceNumber || !invoice.issuedAt) ||
    (invoice.status !== 'ISSUED' && invoice.isOverdue) ||
    (invoice.status === 'ISSUED'
      ? invoice.paymentState === 'NOT_APPLICABLE'
      : invoice.paymentState !== 'NOT_APPLICABLE')
  )
    return invalidInvoice();
  for (const value of [
    invoice.subtotal,
    invoice.discountTotal,
    invoice.taxableTotal,
    invoice.taxTotal,
    invoice.total,
    invoice.amountPaid,
    invoice.balanceDue,
    ...invoice.items.map((item) => item.lineAmount),
  ])
    if (!new RegExp(`^(?:0|[1-9]\\d{0,14})${scale ? `\\.\\d{${scale}}` : ''}$`).test(value))
      return invalidInvoice();
  return invoice;
}
export function parseInvoice(
  body: unknown,
  headers: Headers,
  org: string,
  currency: string,
  id?: string,
): InvoiceResource {
  const parsed = z.object({ data: invoiceSchema }).safeParse(body);
  if (!parsed.success || (id && parsed.data.data.id !== id)) return invalidInvoice();
  const invoice = verified(parsed.data.data, org, currency);
  const etag = headers.get('ETag');
  if (etag !== `"${invoice.version}"`) return invalidInvoice();
  return { invoice, etag };
}
export const defaultFilters = {
  status: '',
  paymentState: '',
  overdue: '',
  search: '',
  customerId: '',
  issueDateFrom: '',
  issueDateTo: '',
  dueDateFrom: '',
  dueDateTo: '',
  sortBy: 'issueDate',
  sortOrder: 'desc',
  limit: 25,
};
export type InvoiceFilters = typeof defaultFilters;
export function parseInvoiceList(
  body: unknown,
  org: string,
  currency: string,
  filters: InvoiceFilters,
) {
  const parsed = z
    .object({
      data: z.array(invoiceSchema),
      meta: z.object({
        limit: z.number().int(),
        nextCursor: z
          .string()
          .min(1)
          .max(2048)
          .regex(/^[A-Za-z0-9_-]+$/)
          .nullable(),
        hasMore: z.boolean(),
      }),
    })
    .safeParse(body);
  if (
    !parsed.success ||
    parsed.data.meta.limit !== filters.limit ||
    parsed.data.data.length > filters.limit ||
    parsed.data.meta.hasMore !== (parsed.data.meta.nextCursor !== null) ||
    (parsed.data.meta.hasMore && !parsed.data.data.length) ||
    new Set(parsed.data.data.map((invoice) => invoice.id)).size !== parsed.data.data.length
  )
    return invalidInvoice();
  for (const invoice of parsed.data.data) {
    verified(invoice, org, currency);
    if (filters.status && filters.status !== invoice.status) return invalidInvoice();
  }
  return parsed.data;
}
