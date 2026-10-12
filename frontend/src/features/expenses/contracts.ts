import { z } from 'zod';
import { ApiError } from '../../api/errors';
import { organizationIdPattern } from '../../organizations/contracts';
import { dateSchema } from '../invoices/contracts';
import { currencyScale, InvoiceDecimal, moneyPattern } from '../invoices/calculation';
const uuid = z.string().regex(organizationIdPattern);
const instant = z.iso.datetime({ offset: true });
const visible = (maximum: number) =>
  z
    .string()
    .refine(
      (value) => !!value.trim() && value.length <= maximum,
      `Enter visible text of at most ${maximum} characters.`,
    );
const nullable = (maximum: number) => visible(maximum).nullable();
export const categorySchema = z.object({
  id: uuid,
  organizationId: uuid,
  name: visible(100),
  description: nullable(500),
  systemKey: z.string().max(50).nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  createdAt: instant,
  updatedAt: instant,
});
export type Category = z.infer<typeof categorySchema>;
export function normalizedCategoryName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}
export const categoryInputSchema = z
  .object({
    name: z.string().refine((value) => {
      const name = normalizedCategoryName(value);
      return !!name && name.length <= 100 && name.toLowerCase().length <= 100;
    }, 'Use 1–100 characters after whitespace normalization.'),
    description: visible(500).optional(),
  })
  .strict();
export function categoryFormSchema(existing?: Category) {
  return z
    .object({ name: categoryInputSchema.shape.name, description: z.string() })
    .superRefine((value, ctx) => {
      if (value.description === '') {
        if (existing?.description)
          ctx.addIssue({
            code: 'custom',
            path: ['description'],
            message: 'The backend does not support clearing an existing category description.',
          });
      } else if (!visible(500).safeParse(value.description).success)
        ctx.addIssue({
          code: 'custom',
          path: ['description'],
          message: 'Use nonblank text of at most 500 characters.',
        });
    });
}
export type CategoryFormValues = z.infer<ReturnType<typeof categoryFormSchema>>;
export const expenseInputSchema = z
  .object({
    categoryId: uuid,
    amount: z
      .string()
      .regex(moneyPattern, 'Use canonical decimal text with up to four decimal places.'),
    expenseDate: dateSchema,
    description: visible(500),
    vendorPayee: nullable(200),
    reference: nullable(150),
    notes: nullable(1000),
  })
  .strict();
export type ExpenseInput = z.infer<typeof expenseInputSchema>;
export function expenseFormSchema(currency: string) {
  return expenseInputSchema
    .extend({
      vendorPayee: z.string().max(200),
      reference: z.string().max(150),
      notes: z.string().max(1000),
    })
    .superRefine((value, ctx) => {
      if (moneyPattern.test(value.amount)) {
        const amount = new InvoiceDecimal(value.amount);
        if (!amount.gt('0') || amount.decimalPlaces() > currencyScale(currency))
          ctx.addIssue({
            code: 'custom',
            path: ['amount'],
            message: `Use a positive amount with at most ${currencyScale(currency)} effective decimal places.`,
          });
      }
      for (const field of ['vendorPayee', 'reference', 'notes'] as const)
        if (value[field] !== '' && !value[field].trim())
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: 'Use visible text or leave empty to clear.',
          });
    });
}
export type ExpenseFormValues = z.infer<ReturnType<typeof expenseFormSchema>>;
export function expensePayload(values: ExpenseFormValues): ExpenseInput {
  return expenseInputSchema.parse({
    ...values,
    vendorPayee: values.vendorPayee === '' ? null : values.vendorPayee,
    reference: values.reference === '' ? null : values.reference,
    notes: values.notes === '' ? null : values.notes,
  });
}
export const voidSchema = z.object({ reason: visible(500) }).strict();
const expenseSchema = z.object({
  id: uuid,
  organizationId: uuid,
  categoryId: uuid,
  category: z.object({
    id: uuid,
    name: visible(100),
    status: z.enum(['ACTIVE', 'ARCHIVED']),
    systemKey: z.string().max(50).nullable(),
  }),
  amount: z.string().regex(moneyPattern),
  currency: z.string().regex(/^[A-Z]{3}$/),
  expenseDate: dateSchema,
  description: visible(500),
  vendorPayee: nullable(200),
  reference: nullable(150),
  notes: nullable(1000),
  status: z.enum(['ACTIVE', 'VOIDED']),
  createdByUserId: uuid,
  voidedByUserId: uuid.nullable(),
  voidedAt: instant.nullable(),
  voidReason: nullable(500),
  version: z.number().int().positive().max(2147483647),
  createdAt: instant,
  updatedAt: instant,
});
export type Expense = z.infer<typeof expenseSchema>;
export type ExpenseResource = { expense: Expense; etag: string };
export function invalidExpense(): never {
  throw new ApiError(
    'The service returned an unexpected expense response.',
    'INVALID_RESPONSE',
    undefined,
    'invalid-response',
  );
}
export function validateCategory(value: unknown, org: string, id?: string) {
  const result = categorySchema.safeParse(value);
  if (!result.success || result.data.organizationId !== org || (id && result.data.id !== id))
    return invalidExpense();
  return result.data;
}
export function parseCategory(body: unknown, org: string, id?: string) {
  const result = z.object({ data: z.unknown() }).safeParse(body);
  if (!result.success) return invalidExpense();
  return validateCategory(result.data.data, org, id);
}
export function validateExpense(
  value: unknown,
  org: string,
  currency: string,
  id?: string,
): Expense {
  const result = expenseSchema.safeParse(value);
  if (!result.success) return invalidExpense();
  const e = result.data;
  const scale = currencyScale(currency);
  const pattern = new RegExp(`^(?:0|[1-9]\\d{0,14})${scale ? `\\.\\d{${scale}}` : ''}$`);
  if (
    e.organizationId !== org ||
    e.currency !== currency ||
    (id && e.id !== id) ||
    e.categoryId !== e.category.id ||
    !pattern.test(e.amount) ||
    !new InvoiceDecimal(e.amount).gt('0') ||
    (e.status === 'ACTIVE'
      ? e.voidedAt !== null || e.voidedByUserId !== null || e.voidReason !== null
      : !e.voidedAt || !e.voidedByUserId || !e.voidReason)
  )
    return invalidExpense();
  return e;
}
export function parseExpense(
  body: unknown,
  headers: Headers,
  org: string,
  currency: string,
  id?: string,
): ExpenseResource {
  const result = z.object({ data: z.unknown() }).safeParse(body);
  if (!result.success) return invalidExpense();
  const expense = validateExpense(result.data.data, org, currency, id);
  const etag = headers.get('ETag');
  if (etag !== `"${expense.version}"`) return invalidExpense();
  return { expense, etag };
}
export const defaultFilters = {
  status: 'ACTIVE',
  categoryId: '',
  vendor: '',
  expenseDateFrom: '',
  expenseDateTo: '',
  sortBy: 'expenseDate',
  sortOrder: 'desc',
  limit: 25,
};
export type ExpenseFilters = typeof defaultFilters;
export type CategoryFilters = { status: 'ACTIVE' | 'ARCHIVED'; limit: number };
export function validFilters(filters: ExpenseFilters) {
  const { expenseDateFrom: from, expenseDateTo: to } = filters;
  return (
    (!filters.categoryId || organizationIdPattern.test(filters.categoryId)) &&
    (!filters.vendor || (filters.vendor.length <= 200 && !!filters.vendor.trim())) &&
    (!from || dateSchema.safeParse(from).success) &&
    (!to || dateSchema.safeParse(to).success) &&
    (!from || !to || (from <= to && (Date.parse(to) - Date.parse(from)) / 86400000 <= 1825))
  );
}
export function parsePage<T>(
  body: unknown,
  limit: number,
  parse: (row: unknown) => T,
  identity: (row: T) => string,
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
  if (!result.success) return invalidExpense();
  const { meta } = result.data;
  const data = result.data.data.map(parse);
  if (
    meta.limit !== limit ||
    data.length > limit ||
    meta.hasMore !== (meta.nextCursor !== null) ||
    (meta.hasMore && !data.length) ||
    new Set(data.map(identity)).size !== data.length
  )
    return invalidExpense();
  return { data, meta };
}
