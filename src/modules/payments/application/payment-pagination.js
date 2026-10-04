import { createHash } from 'node:crypto';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { MONEY_PATTERN } from '../../../common/money/decimal.js';
import { businessDate } from '../../../common/time/business-date.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function paymentListOptions(organizationId, query) {
  const options = {
    organizationId,
    invoiceId: query.invoiceId?.toLowerCase() ?? null,
    status: query.status ?? null,
    method: query.method ?? null,
    paymentDateFrom: query.paymentDateFrom ?? null,
    paymentDateTo: query.paymentDateTo ?? null,
    sortBy: query.sortBy ?? 'paymentDate',
    sortOrder: query.sortOrder ?? 'desc',
  };
  const from = options.paymentDateFrom ? businessDate(options.paymentDateFrom) : null;
  const to = options.paymentDateTo ? businessDate(options.paymentDateTo) : null;
  if (from && to && (to < from || (to - from) / 86400000 > 1825))
    throw new ApplicationError(
      ERROR_CODES.INVALID_REQUEST,
      'Date range must be ordered and at most 1,825 days.',
    );
  return {
    ...options,
    limit: Number(query.limit ?? 25),
    signature: createHash('sha256').update(JSON.stringify(options)).digest('hex'),
  };
}
function invalid() {
  return new ApplicationError(
    ERROR_CODES.INVALID_CURSOR,
    'Cursor is invalid for this payment list.',
  );
}
export function encodePaymentCursor(row, options) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      signature: options.signature,
      key: {
        id: row.id,
        value:
          options.sortBy === 'amount' ? row.amount.toString() : row[options.sortBy].toISOString(),
      },
    }),
  ).toString('base64url');
}
export function decodePaymentCursor(cursor, options) {
  if (cursor === undefined) return null;
  try {
    if (typeof cursor !== 'string' || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))
      throw invalid();
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw invalid();
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (
      parsed.v !== 1 ||
      parsed.signature !== options.signature ||
      Object.keys(parsed).sort().join() !== 'key,signature,v' ||
      !parsed.key ||
      Object.keys(parsed.key).sort().join() !== 'id,value' ||
      typeof parsed.key.id !== 'string' ||
      !UUID.test(parsed.key.id) ||
      typeof parsed.key.value !== 'string'
    )
      throw invalid();
    if (
      options.sortBy === 'amount'
        ? !MONEY_PATTERN.test(parsed.key.value)
        : new Date(parsed.key.value).toISOString() !== parsed.key.value
    )
      throw invalid();
    return parsed.key;
  } catch {
    throw invalid();
  }
}

export function paymentListFilter(options, key) {
  const filters = [];
  if (options.invoiceId) filters.push({ invoiceId: options.invoiceId });
  if (options.status) filters.push({ status: options.status });
  if (options.method) filters.push({ paymentMethod: options.method });
  const range = {};
  if (options.paymentDateFrom) range.gte = businessDate(options.paymentDateFrom);
  if (options.paymentDateTo) range.lte = businessDate(options.paymentDateTo);
  if (Object.keys(range).length) filters.push({ paymentDate: range });
  if (key) {
    const value = options.sortBy === 'amount' ? key.value : new Date(key.value);
    const operator = options.sortOrder === 'asc' ? 'gt' : 'lt';
    filters.push({
      OR: [
        { [options.sortBy]: { [operator]: value } },
        { [options.sortBy]: value, id: { [operator]: key.id } },
      ],
    });
  }
  return { AND: filters };
}
