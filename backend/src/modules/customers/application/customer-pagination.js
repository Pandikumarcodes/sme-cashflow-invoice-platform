import { createHash } from 'node:crypto';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function customerListOptions(organizationId, query) {
  const options = {
    organizationId,
    status: query.status ?? 'ACTIVE',
    search: query.search ?? '',
    sortBy: query.sortBy ?? 'displayName',
    sortOrder: query.sortOrder ?? 'asc',
  };
  const signature = createHash('sha256').update(JSON.stringify(options)).digest('hex');
  return { ...options, signature, limit: Number(query.limit ?? 25) };
}

function invalidCursor() {
  return new ApplicationError(
    ERROR_CODES.INVALID_CURSOR,
    'Cursor is invalid for this customer list.',
  );
}

function hasExactKeys(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

export function decodeCustomerCursor(cursor, options) {
  if (cursor === undefined) return null;
  try {
    if (typeof cursor !== 'string' || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))
      throw invalidCursor();
    const buffer = Buffer.from(cursor, 'base64url');
    if (buffer.toString('base64url') !== cursor) throw invalidCursor();
    const parsed = JSON.parse(buffer.toString('utf8'));
    if (
      !hasExactKeys(parsed, ['v', 'signature', 'key']) ||
      parsed.v !== 1 ||
      parsed.signature !== options.signature ||
      !hasExactKeys(parsed.key, ['id', 'value']) ||
      typeof parsed.key.id !== 'string' ||
      !UUID.test(parsed.key.id) ||
      typeof parsed.key.value !== 'string'
    )
      throw invalidCursor();
    if (options.sortBy === 'displayName') {
      if (parsed.key.value.length > 200 || !/\S/.test(parsed.key.value)) throw invalidCursor();
    } else if (new Date(parsed.key.value).toISOString() !== parsed.key.value) {
      throw invalidCursor();
    }
    return parsed.key;
  } catch {
    throw invalidCursor();
  }
}

export function encodeCustomerCursor(customer, options) {
  const value =
    options.sortBy === 'displayName'
      ? customer.displayName
      : customer[options.sortBy].toISOString();
  return Buffer.from(
    JSON.stringify({
      v: 1,
      signature: options.signature,
      key: { id: customer.id, value },
    }),
  ).toString('base64url');
}

export function customerListFilter(options, key) {
  const filters = [{ status: options.status }];
  if (options.search) {
    // Prisma contains uses LIKE; escape metacharacters for literal user search.
    const search = options.search.replace(/[\\%_]/g, '\\$&');
    filters.push({
      OR: [
        { displayName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  if (key) {
    const value = options.sortBy === 'displayName' ? key.value : new Date(key.value);
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
