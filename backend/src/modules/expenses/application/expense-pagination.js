import { createHash } from 'node:crypto';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { MONEY_PATTERN } from '../../../common/money/decimal.js';
import { expenseDate } from '../domain/expense-policy.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () =>
  new ApplicationError(ERROR_CODES.INVALID_CURSOR, 'Cursor is invalid for this list.');
export function listOptions(organizationId, query, categories = false) {
  const scope = {
    organizationId,
    categories,
    status: query.status ?? 'ACTIVE',
    sortBy: categories ? 'name' : (query.sortBy ?? 'expenseDate'),
    sortOrder: categories ? 'asc' : (query.sortOrder ?? 'desc'),
  };
  if (!categories) {
    for (const field of ['categoryId', 'expenseDateFrom', 'expenseDateTo', 'vendor'])
      scope[field] = query[field] ?? null;
    const from = scope.expenseDateFrom ? expenseDate(scope.expenseDateFrom) : null;
    const to = scope.expenseDateTo ? expenseDate(scope.expenseDateTo) : null;
    if (from && to && (to < from || (to - from) / 86400000 > 1825))
      throw new ApplicationError(
        ERROR_CODES.INVALID_REQUEST,
        'Date range must be ordered and at most 1,825 days.',
      );
  }
  return {
    ...scope,
    limit: Number(query.limit ?? 25),
    signature: createHash('sha256').update(JSON.stringify(scope)).digest('hex'),
  };
}
export function encodeCursor(row, options) {
  const raw = row[options.sortBy];
  const value = raw === null ? null : raw instanceof Date ? raw.toISOString() : raw.toString();
  return Buffer.from(
    JSON.stringify({ v: 1, signature: options.signature, key: { id: row.id, value } }),
  ).toString('base64url');
}
export function decodeCursor(cursor, options) {
  if (cursor === undefined) return null;
  try {
    if (typeof cursor !== 'string' || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))
      throw invalid();
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw invalid();
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (
      Object.keys(parsed).sort().join() !== 'key,signature,v' ||
      parsed.v !== 1 ||
      parsed.signature !== options.signature ||
      !parsed.key ||
      Object.keys(parsed.key).sort().join() !== 'id,value' ||
      typeof parsed.key.id !== 'string' ||
      !UUID.test(parsed.key.id)
    )
      throw invalid();
    const value = parsed.key.value;
    if (options.sortBy === 'vendorPayee' && value === null) return parsed.key;
    if (typeof value !== 'string') throw invalid();
    if (['name', 'vendorPayee'].includes(options.sortBy)) {
      if (!value.trim() || value.length > (options.categories ? 100 : 200)) throw invalid();
    } else if (options.sortBy === 'amount') {
      if (!MONEY_PATTERN.test(value)) throw invalid();
    } else if (new Date(value).toISOString() !== value) throw invalid();
    return parsed.key;
  } catch {
    throw invalid();
  }
}
export function listFilter(options, key) {
  const filters = [{ status: options.status }];
  if (options.categoryId) filters.push({ expenseCategoryId: options.categoryId });
  if (options.vendor)
    filters.push({
      vendorPayee: { contains: options.vendor.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' },
    });
  const range = {};
  if (options.expenseDateFrom) range.gte = expenseDate(options.expenseDateFrom);
  if (options.expenseDateTo) range.lte = expenseDate(options.expenseDateTo);
  if (Object.keys(range).length) filters.push({ expenseDate: range });
  if (key) {
    const field = options.sortBy;
    const op = options.sortOrder === 'asc' ? 'gt' : 'lt';
    const value = ['expenseDate', 'createdAt'].includes(field) ? new Date(key.value) : key.value;
    if (value === null) filters.push({ vendorPayee: null, id: { [op]: key.id } });
    else
      filters.push({
        OR: [
          { [field]: { [op]: value } },
          { [field]: value, id: { [op]: key.id } },
          ...(field === 'vendorPayee' ? [{ vendorPayee: null }] : []),
        ],
      });
  }
  return { AND: filters };
}
export function listOrder(options) {
  return [
    {
      [options.sortBy]:
        options.sortBy === 'vendorPayee'
          ? { sort: options.sortOrder, nulls: 'last' }
          : options.sortOrder,
    },
    { id: options.sortOrder },
  ];
}
export function listResponse(rows, options, mapper) {
  const hasMore = rows.length > options.limit;
  const page = rows.slice(0, options.limit);
  return {
    data: page.map(mapper),
    meta: {
      limit: options.limit,
      nextCursor: hasMore ? encodeCursor(page.at(-1), options) : null,
      hasMore,
    },
  };
}
