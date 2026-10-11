import { randomUUID } from 'node:crypto';
import {
  notificationOptions,
  notificationCursor,
  notificationFilter,
  toNotificationResponse,
} from './notification.js';
const tenant = { organizationId: randomUUID(), userId: randomUUID() };
const row = {
  id: randomUUID(),
  organizationId: tenant.organizationId,
  type: 'SYSTEM',
  status: 'UNREAD',
  title: 'Notice',
  body: 'Safe',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};
describe('notification inbox cursors and serialization', () => {
  it('defaults to newest non-archived inbox rows', () => {
    const options = notificationOptions(tenant, {});
    expect(options).toMatchObject({ limit: 25, sortOrder: 'desc', status: null });
    expect(notificationFilter(options)).toEqual({ AND: [{ status: { not: 'ARCHIVED' } }] });
  });
  it('binds cursor scope to tenant, recipient, status and sort', () => {
    const options = notificationOptions(tenant, {}),
      cursor = notificationCursor(row, options);
    expect(notificationFilter(options, cursor).AND[1].OR[0]).toEqual({
      createdAt: { lt: row.createdAt },
    });
    for (const modified of [
      notificationOptions({ ...tenant, organizationId: randomUUID() }, {}),
      notificationOptions({ ...tenant, userId: randomUUID() }, {}),
      notificationOptions(tenant, { status: 'READ' }),
      notificationOptions(tenant, { sortOrder: 'asc' }),
    ])
      expect(() => notificationFilter(modified, cursor)).toThrow();
  });
  it.each(['garbage', '', 'x'.repeat(2049)])('rejects malformed cursor %s', (cursor) =>
    expect(() => notificationFilter(notificationOptions(tenant, {}), cursor)).toThrow(),
  );
  it('serializes safe timestamps and excludes internal/recipient/dedupe metadata', () => {
    const result = toNotificationResponse({
      ...row,
      recipientUserId: tenant.userId,
      metadata: { internal: 'secret' },
      deduplicationKey: 'internal-key',
    });
    expect(result.readAt).toBeNull();
    expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(JSON.stringify(result)).not.toMatch(/secret|internal-key|recipientUserId/);
  });
});
