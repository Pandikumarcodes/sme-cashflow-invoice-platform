import { z } from 'zod';
import { ApiError } from '../../api/errors';
import { organizationIdPattern } from '../../organizations/contracts';
const text = (maximum: number) =>
  z
    .string()
    .refine((value) => /\S/.test(value), 'Enter visible text.')
    .refine((value) => Array.from(value).length <= maximum, `Use at most ${maximum} characters.`);
export const customerFormSchema = z
  .object({
    displayName: text(200),
    customerCode: z.union([z.literal(''), text(50)]),
    email: z.union([
      z.literal(''),
      z.email().refine((value) => Array.from(value).length <= 320, 'Use at most 320 characters.'),
    ]),
  })
  .strict();
export type CustomerFormValues = z.infer<typeof customerFormSchema>;
export function customerPayload(values: CustomerFormValues) {
  const parsed = customerFormSchema.parse(values);
  return {
    displayName: parsed.displayName,
    customerCode: parsed.customerCode === '' ? null : parsed.customerCode,
    email: parsed.email === '' ? null : parsed.email,
  };
}
export const customerSchema = z.object({
  id: z.string().regex(organizationIdPattern),
  organizationId: z.string().regex(organizationIdPattern),
  displayName: text(200),
  customerCode: text(50).nullable(),
  email: z.string().nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  createdByUserId: z.uuid(),
  version: z.number().int().min(1).max(2147483647),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Customer = z.infer<typeof customerSchema>;
export type CustomerResource = { customer: Customer; etag: string };
const cursor = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+$/);
const listSchema = z.object({
  data: z.array(customerSchema),
  meta: z.object({
    limit: z.number().int().min(1).max(100),
    nextCursor: cursor.nullable(),
    hasMore: z.boolean(),
  }),
});
export type CustomerList = z.infer<typeof listSchema>;
function invalid(): never {
  throw new ApiError(
    'The customer response could not be verified.',
    'INVALID_RESPONSE',
    undefined,
    'invalid-response',
  );
}
export function parseCustomer(
  body: unknown,
  headers: Headers,
  organizationId: string,
  customerId?: string,
): CustomerResource {
  const result = z.object({ data: customerSchema }).safeParse(body);
  if (
    !result.success ||
    result.data.data.organizationId !== organizationId ||
    (customerId && result.data.data.id !== customerId)
  )
    return invalid();
  const etag = headers.get('ETag');
  if (etag !== `"${result.data.data.version}"`) return invalid();
  return { customer: result.data.data, etag };
}
export function parseCustomerList(
  body: unknown,
  organizationId: string,
  limit: number,
  status: Customer['status'],
): CustomerList {
  const result = listSchema.safeParse(body);
  if (
    !result.success ||
    result.data.meta.limit !== limit ||
    result.data.data.length > limit ||
    result.data.meta.hasMore !== (result.data.meta.nextCursor !== null) ||
    (result.data.meta.hasMore && !result.data.data.length) ||
    result.data.data.some(
      (customer) => customer.organizationId !== organizationId || customer.status !== status,
    ) ||
    new Set(result.data.data.map((customer) => customer.id)).size !== result.data.data.length
  )
    return invalid();
  return result.data;
}
export type CustomerFilters = {
  status: Customer['status'];
  search: string;
  sortBy: 'displayName' | 'createdAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
  limit: number;
};
