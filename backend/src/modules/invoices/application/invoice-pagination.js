import { createHash } from 'node:crypto';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { businessDate, localDate } from '../domain/invoice-policy.js';
import { MONEY_PATTERN } from '../../../common/money/decimal.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILTERS = [
  'status',
  'paymentState',
  'overdue',
  'customerId',
  'issueDateFrom',
  'issueDateTo',
  'dueDateFrom',
  'dueDateTo',
  'search',
];
export function invoiceListOptions(organizationId, query, timezone) {
  const options = {
    organizationId,
    sortBy: query.sortBy ?? 'issueDate',
    sortOrder: query.sortOrder ?? 'desc',
  };
  for (const field of FILTERS) options[field] = query[field] ?? null;
  for (const prefix of ['issueDate', 'dueDate']) {
    const from = options[prefix + 'From'] ? businessDate(options[prefix + 'From']) : null;
    const to = options[prefix + 'To'] ? businessDate(options[prefix + 'To']) : null;
    if (from && to && (to < from || (to - from) / 86400000 > 1825))
      throw new ApplicationError(
        ERROR_CODES.INVALID_REQUEST,
        'Date range must be ordered and at most 1,825 days.',
      );
  }
  options.today = options.overdue === null ? null : localDate(timezone);
  return {
    ...options,
    limit: Number(query.limit ?? 25),
    signature: createHash('sha256').update(JSON.stringify(options)).digest('hex'),
  };
}
function invalid() {
  return new ApplicationError(
    ERROR_CODES.INVALID_CURSOR,
    'Cursor is invalid for this invoice list.',
  );
}
export function encodeInvoiceCursor(row, options) {
  const raw = row[options.sortBy];
  const value = raw === null ? null : raw instanceof Date ? raw.toISOString() : raw.toString();
  return Buffer.from(
    JSON.stringify({ v: 1, signature: options.signature, key: { id: row.id, value } }),
  ).toString('base64url');
}
export function decodeInvoiceCursor(cursor, options) {
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
      typeof parsed.key.id !== 'string' ||
      Object.keys(parsed.key).sort().join() !== 'id,value' ||
      !UUID.test(parsed.key.id)
    )
      throw invalid();
    const value = parsed.key.value;
    if (options.sortBy === 'invoiceNumber') {
      if (value !== null && (typeof value !== 'string' || !value.length || value.length > 40))
        throw invalid();
    } else if (typeof value !== 'string') throw invalid();
    else if (options.sortBy === 'total') {
      if (!MONEY_PATTERN.test(value)) throw invalid();
    } else if (new Date(value).toISOString() !== value) throw invalid();
    return parsed.key;
  } catch {
    throw invalid();
  }
}

export function invoiceListFilter(options, key) {
  const filters = [];
  if (options.status) filters.push({ status: options.status });
  if (options.customerId) filters.push({ customerId: options.customerId });
  if (options.paymentState === 'NOT_APPLICABLE') filters.push({ status: { not: 'ISSUED' } });
  else if (options.paymentState)
    filters.push({
      status: 'ISSUED',
      ...{
        UNPAID: { amountPaid: '0' },
        PARTIALLY_PAID: { amountPaid: { gt: '0' }, balanceDue: { gt: '0' } },
        PAID: { balanceDue: '0' },
      }[options.paymentState],
    });
  if (options.overdue !== null) {
    const overdue = {
      status: 'ISSUED',
      balanceDue: { gt: '0' },
      dueDate: { lt: businessDate(options.today) },
    };
    filters.push(options.overdue === 'true' ? overdue : { NOT: overdue });
  }
  for (const prefix of ['issueDate', 'dueDate']) {
    const range = {};
    if (options[prefix + 'From']) range.gte = businessDate(options[prefix + 'From']);
    if (options[prefix + 'To']) range.lte = businessDate(options[prefix + 'To']);
    if (Object.keys(range).length) filters.push({ [prefix]: range });
  }
  if (options.search) {
    const text = { contains: options.search.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' };
    filters.push({
      OR: [
        { invoiceNumber: text },
        { billToName: text },
        { status: 'DRAFT', customer: { displayName: text } },
      ],
    });
  }
  if (key) {
    const field = options.sortBy;
    const operator = options.sortOrder === 'asc' ? 'gt' : 'lt';
    const value = ['issueDate', 'dueDate', 'createdAt'].includes(field)
      ? new Date(key.value)
      : key.value;
    if (value === null) filters.push({ invoiceNumber: null, id: { [operator]: key.id } });
    else
      filters.push({
        OR: [
          { [field]: { [operator]: value } },
          { [field]: value, id: { [operator]: key.id } },
          ...(field === 'invoiceNumber' ? [{ invoiceNumber: null }] : []),
        ],
      });
  }
  return { AND: filters };
}
