import { createHash } from 'node:crypto';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';

export function notificationOptions(tenant, query) {
  const filters = {
    organizationId: tenant.organizationId,
    recipientUserId: tenant.userId,
    status: query.status ?? null,
    sortOrder: query.sortOrder ?? 'desc',
  };
  return {
    ...filters,
    limit: Number(query.limit ?? 25),
    signature: createHash('sha256').update(JSON.stringify(filters)).digest('hex'),
  };
}
export function notificationCursor(row, options) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      signature: options.signature,
      key: { id: row.id, value: row.createdAt.toISOString() },
    }),
  ).toString('base64url');
}
export function notificationFilter(options, cursor) {
  const filters = [options.status ? { status: options.status } : { status: { not: 'ARCHIVED' } }];
  if (cursor !== undefined) {
    try {
      if (typeof cursor !== 'string' || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))
        throw new Error();
      const buffer = Buffer.from(cursor, 'base64url');
      if (buffer.toString('base64url') !== cursor) throw new Error();
      const value = JSON.parse(buffer.toString('utf8'));
      if (
        !value ||
        Object.keys(value).sort().join(',') !== 'key,signature,v' ||
        value.v !== 1 ||
        value.signature !== options.signature ||
        !value.key ||
        Object.keys(value.key).sort().join(',') !== 'id,value' ||
        typeof value.key.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value.key.id,
        ) ||
        typeof value.key.value !== 'string' ||
        new Date(value.key.value).toISOString() !== value.key.value
      )
        throw new Error();
      const operator = options.sortOrder === 'asc' ? 'gt' : 'lt';
      const createdAt = new Date(value.key.value);
      filters.push({
        OR: [
          { createdAt: { [operator]: createdAt } },
          { createdAt, id: { [operator]: value.key.id } },
        ],
      });
    } catch {
      throw new ApplicationError(ERROR_CODES.INVALID_CURSOR, 'Cursor is invalid for this inbox.');
    }
  }
  return { AND: filters };
}
export function toNotificationResponse(row) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    type: row.type,
    status: row.status,
    title: row.title,
    body: row.body,
    relatedEntityType: row.relatedEntityType,
    relatedEntityId: row.relatedEntityId,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    readAt: row.readAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
