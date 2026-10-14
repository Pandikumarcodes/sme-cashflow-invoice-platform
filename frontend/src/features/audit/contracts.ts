import { z } from 'zod';
import { ApiError } from '../../api/errors';
import { calendarDate } from '../dashboard/dates';
import { pageMeta, uuid } from '../reports/contracts';
export type AuditFilters = {
  limit: 25 | 50 | 100;
  sortOrder: 'asc' | 'desc';
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  occurredFrom: string;
  occurredTo: string;
};
export const defaultFilters: AuditFilters = {
  limit: 25,
  sortOrder: 'desc',
  actorUserId: '',
  action: '',
  entityType: '',
  entityId: '',
  occurredFrom: '',
  occurredTo: '',
};
export function auditFilterError(filters: AuditFilters) {
  for (const field of ['actorUserId', 'entityId'] as const)
    if (filters[field] && !uuid.safeParse(filters[field]).success)
      return 'Enter valid actor/entity UUIDs.';
  if (filters.action.length > 100 || filters.entityType.length > 50)
    return 'Action/entity type exceeds its supported length.';
  const from = filters.occurredFrom ? calendarDate(filters.occurredFrom) : undefined,
    to = filters.occurredTo ? calendarDate(filters.occurredTo) : undefined;
  if (
    (filters.occurredFrom && !from) ||
    (filters.occurredTo && !to) ||
    filters.occurredTo === '9999-12-31'
  )
    return 'Enter supported real calendar dates.';
  if (from && to && ((to.getTime() - from.getTime()) / 86400000 + 1 > 1825 || from > to))
    return 'Choose an ordered range of at most 1,825 inclusive days.';
}
const fields: Record<string, readonly string[]> = {
  Organization: [
    'baseCurrency',
    'timezone',
    'locale',
    'invoicePrefix',
    'invoiceNumberPadding',
    'defaultPaymentTermsDays',
    'status',
    'ownerMembershipId',
  ],
  Membership: ['role', 'status', 'ownerMembershipId'],
  OrganizationInvitation: ['role', 'status', 'expiresAt', 'membershipId'],
  Customer: ['status', 'version'],
  Invoice: [
    'status',
    'invoiceNumber',
    'customerId',
    'total',
    'taxRate',
    'version',
    'issueDate',
    'dueDate',
    'currency',
    'subtotal',
    'discountTotal',
    'taxableTotal',
    'taxTotal',
    'amountPaid',
    'balanceDue',
    'issuedAt',
  ],
  Payment: ['id', 'amount', 'currency', 'status', 'updatedAt', 'reversedAt', 'reversalId'],
  ExpenseCategory: ['status', 'systemKey'],
  Expense: [
    'categoryId',
    'amount',
    'currency',
    'expenseDate',
    'status',
    'version',
    'createdByUserId',
    'voidedByUserId',
    'voidedAt',
  ],
  ReportExport: ['reportType', 'format'],
};
const scalar = z.union([z.string().max(2048), z.number().finite(), z.boolean(), z.null()]);
export function safeAuditData(value: unknown, entityType: string) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Object.hasOwn(fields, entityType)
  )
    return null;
  const result: Record<string, string | number | boolean | null> = {};
  for (const key of fields[entityType]!) {
    if (Object.hasOwn(value, key)) {
      const parsed = scalar.safeParse((value as Record<string, unknown>)[key]);
      if (parsed.success) result[key] = parsed.data;
    }
  }
  return Object.keys(result).length ? result : null;
}
const rowSchema = z
  .object({
    id: uuid,
    organizationId: uuid,
    actorType: z.enum(['USER', 'SYSTEM', 'WORKER']),
    actorUserId: uuid.nullable(),
    actorMembershipId: uuid.nullable(),
    action: z.string().min(1).max(100),
    entityType: z.string().min(1).max(50),
    entityId: uuid.nullable(),
    outcome: z.enum(['SUCCESS', 'DENIED', 'FAILURE']),
    source: z.enum(['API', 'WORKER', 'SYSTEM']),
    occurredAt: z.iso.datetime({ offset: true }),
    requestId: z.string().max(100).nullable(),
    correlationId: z.string().max(100).nullable(),
    changedFields: z.array(z.string()).max(100),
    beforeData: z.unknown(),
    afterData: z.unknown(),
    metadata: z.unknown(),
  })
  .transform((row) => ({
    ...row,
    changedFields: row.changedFields.filter(
      (field) => Object.hasOwn(fields, row.entityType) && fields[row.entityType]!.includes(field),
    ),
    beforeData: safeAuditData(row.beforeData, row.entityType),
    afterData: safeAuditData(row.afterData, row.entityType),
    metadata: null,
  }));
export type AuditEntry = z.infer<typeof rowSchema>;
export function parseAuditPage(body: unknown, org: string, filters: AuditFilters) {
  const result = z.object({ data: z.array(rowSchema).max(100), meta: pageMeta }).safeParse(body);
  const invalid = () => {
    throw new ApiError(
      'The audit response could not be verified.',
      'INVALID_RESPONSE',
      undefined,
      'invalid-response',
    );
  };
  if (!result.success) return invalid();
  const page = result.data;
  if (
    page.meta.limit !== filters.limit ||
    page.data.length > filters.limit ||
    page.meta.hasMore !== (page.meta.nextCursor !== null) ||
    page.data.some(
      (row) =>
        row.organizationId !== org ||
        (filters.actorUserId && row.actorUserId !== filters.actorUserId) ||
        (filters.entityId && row.entityId !== filters.entityId) ||
        (filters.entityType && row.entityType !== filters.entityType) ||
        (filters.action && row.action !== filters.action),
    )
  )
    return invalid();
  return page;
}
