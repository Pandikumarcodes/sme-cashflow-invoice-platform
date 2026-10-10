import { createHash } from 'node:crypto';
import { z } from 'zod';
import { businessDate } from '../../../common/time/business-date.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';

const querySchema = z
  .object({
    limit: z
      .string()
      .regex(/^(?:[1-9]\d?|100)$/)
      .optional(),
    after: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    sortBy: z.literal('occurredAt').optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    actorUserId: z.uuid().optional(),
    action: z.string().min(1).max(100).optional(),
    entityType: z.string().min(1).max(50).optional(),
    entityId: z.uuid().optional(),
    occurredFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    occurredTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

// First instant on/after the requested local calendar day. Searching calendar
// dates also handles DST transitions at midnight and skipped local dates.
export function auditDayStart(day, timezone) {
  const midnight = businessDate(day).getTime();
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    era: 'short',
  });
  const dateAt = (instant) => {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (type) => parts.find((p) => p.type === type).value;
    const year = part('era') === 'BC' ? 1 - Number(part('year')) : Number(part('year'));
    return year * 10000 + Number(part('month')) * 100 + Number(part('day'));
  };
  let low = midnight - 36 * 3600000;
  let high = midnight + 36 * 3600000;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (dateAt(middle) < Number(day.replaceAll('-', ''))) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
}

export function auditOptions(organizationId, query = {}, timezone) {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success)
    throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Audit query is invalid.');
  const input = parsed.data;
  const from = input.occurredFrom ? businessDate(input.occurredFrom) : null;
  const to = input.occurredTo ? businessDate(input.occurredTo) : null;
  if (from && to && (from > to || (to - from) / 86400000 + 1 > 1825))
    throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Audit date range is invalid.');
  if (to && input.occurredTo === '9999-12-31')
    throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Audit end date is out of range.');
  const bounds = {
    ...(from ? { gte: auditDayStart(input.occurredFrom, timezone) } : {}),
    ...(to
      ? {
          lt: auditDayStart(new Date(to.getTime() + 86400000).toISOString().slice(0, 10), timezone),
        }
      : {}),
  };
  const filters = {};
  for (const field of ['actorUserId', 'action', 'entityType', 'entityId']) {
    if (input[field] !== undefined) filters[field] = input[field];
  }
  if (from || to) filters.occurredAt = bounds;
  const sortOrder = input.sortOrder ?? 'desc';
  const signature = createHash('sha256')
    .update(JSON.stringify({ organizationId, filters, sortOrder }))
    .digest('hex');
  return { filters, sortOrder, signature, limit: Number(input.limit ?? 25), after: input.after };
}

export function auditCursor(row, options) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      signature: options.signature,
      key: { id: row.id, value: row.occurredAt.toISOString() },
    }),
  ).toString('base64url');
}

export function auditFilter(options) {
  const filters = [options.filters];
  if (options.after !== undefined) {
    try {
      const buffer = Buffer.from(options.after, 'base64url');
      if (buffer.toString('base64url') !== options.after) throw new Error();
      const cursor = z
        .object({
          v: z.literal(1),
          signature: z.literal(options.signature),
          key: z.object({ id: z.uuid(), value: z.string() }).strict(),
        })
        .strict()
        .parse(JSON.parse(buffer.toString('utf8')));
      const occurredAt = new Date(cursor.key.value);
      if (occurredAt.toISOString() !== cursor.key.value) throw new Error();
      const operator = options.sortOrder === 'asc' ? 'gt' : 'lt';
      filters.push({
        OR: [
          { occurredAt: { [operator]: occurredAt } },
          { occurredAt, id: { [operator]: cursor.key.id } },
        ],
      });
    } catch {
      throw new ApplicationError(
        ERROR_CODES.INVALID_CURSOR,
        'Cursor is invalid for this audit list.',
      );
    }
  }
  return { AND: filters };
}
