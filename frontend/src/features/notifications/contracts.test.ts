import { expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { defaultFilters, parseNotificationPage, parseNotificationCommand } from './contracts';
import {
  notification,
  notificationPage,
  notificationId,
  readNotification,
  invoiceId,
  instant,
} from './test-fixtures';
import { notificationDestination, notificationLabel, notificationTimestamp } from './presentation';
import { dashboardOrg as a, secondOrg as b } from '../dashboard/test-fixtures';
import { notificationKeys, invalidateNotificationReads } from './queries';
import { safeReturnTo } from '../../auth/return-to';
it('preserves supported fields while hiding internal recipient, dedupe and metadata', () => {
  const row = {
    ...notification(),
    recipientUserId: 'secret-recipient',
    metadata: { internal: 'worker-id' },
    deduplicationKey: 'internal-key',
  };
  const parsed = parseNotificationPage(notificationPage([row]), a.id, defaultFilters);
  expect(parsed.data[0]).toEqual(notification());
  expect(parsed).not.toHaveProperty('data.0.metadata');
});
it.each(['UNREAD', 'READ', 'ARCHIVED'] as const)(
  'accepts %s with its authoritative timestamps',
  (status) => {
    const row = notification({
      status,
      readAt: status === 'READ' ? instant : null,
      archivedAt: status === 'ARCHIVED' ? instant : null,
    });
    expect(
      parseNotificationPage(notificationPage([row]), a.id, { ...defaultFilters, status }).data[0]
        ?.status,
    ).toBe(status);
  },
);
it.each([
  'foreign',
  'state',
  'numeric-id',
  'missing-body',
  'duplicate',
  'wrong-limit',
  'bad-cursor',
  'more-without-cursor',
  'short-more',
  'unordered',
  'archive-in-inbox',
  'wrong-filter',
] as const)('rejects invalid notification response: %s', (kind) => {
  const body = notificationPage([notification(), readNotification()]);
  if (kind === 'foreign') body.data[0]!.organizationId = b.id;
  if (kind === 'state') body.data[0]!.readAt = instant;
  if (kind === 'numeric-id') Object.assign(body.data[0]!, { id: 123 });
  if (kind === 'missing-body') Object.assign(body.data[0]!, { body: undefined });
  if (kind === 'duplicate') body.data.push(body.data[0]!);
  if (kind === 'wrong-limit') body.meta.limit = 50;
  if (kind === 'bad-cursor') body.meta.nextCursor = 'https://evil.test';
  if (kind === 'more-without-cursor') body.meta.hasMore = true;
  if (kind === 'short-more') {
    body.meta.hasMore = true;
    body.meta.nextCursor = 'opaque_next';
  }
  if (kind === 'unordered') body.data.reverse();
  if (kind === 'archive-in-inbox')
    Object.assign(body.data[0]!, { status: 'ARCHIVED', archivedAt: instant });
  const filters =
    kind === 'wrong-filter' ? { ...defaultFilters, status: 'UNREAD' as const } : defaultFilters;
  expect(() => parseNotificationPage(body, a.id, filters)).toThrow();
});
it('accepts ascending timestamp/id sorting and complete empty pages', () => {
  const rows = [readNotification(), notification()];
  expect(
    parseNotificationPage(notificationPage(rows), a.id, { ...defaultFilters, sortOrder: 'asc' })
      .data,
  ).toEqual(rows);
  expect(parseNotificationPage(notificationPage([]), a.id, defaultFilters).data).toEqual([]);
});
it('validates successful read/archive identities without resurrecting archived notifications', () => {
  const archived = notification({ status: 'ARCHIVED', archivedAt: instant });
  expect(parseNotificationCommand({ data: archived }, a.id, notificationId, 'read').status).toBe(
    'ARCHIVED',
  );
  expect(parseNotificationCommand({ data: archived }, a.id, notificationId, 'archive')).toEqual(
    archived,
  );
  expect(() =>
    parseNotificationCommand({ data: readNotification() }, a.id, notificationId, 'read'),
  ).toThrow();
  expect(() =>
    parseNotificationCommand({ data: notification() }, a.id, notificationId, 'read'),
  ).toThrow();
  expect(() =>
    parseNotificationCommand(
      { data: notification({ ...archived, organizationId: b.id }) },
      a.id,
      notificationId,
      'archive',
    ),
  ).toThrow();
});
it.each([
  ['Invoice', 'invoices', 'invoice.read'],
  ['Payment', 'payments', 'payment.read'],
  ['Customer', 'customers', 'customer.read'],
])(
  'resolves structured %s references only within the current tenant',
  (type, route, permission) => {
    const row = notification({ relatedEntityType: type });
    expect(notificationDestination(row, a.id, (p) => p === permission)).toBe(
      `/organizations/${a.id}/${route}/${invoiceId}`,
    );
    expect(notificationDestination(row, a.id, () => false)).toBeNull();
    expect(notificationDestination(row, b.id, () => true)).toBeNull();
  },
);
it.each([
  'ReportExport',
  'ReminderDelivery',
  'organization',
  'https://evil.test',
  'Invoice/../organizations',
])('does not invent navigation for %s', (type) =>
  expect(
    notificationDestination(notification({ relatedEntityType: type }), a.id, () => true),
  ).toBeNull(),
);
it('never parses links/IDs from human text or extra metadata', () => {
  const row = notification({
    body: `Open /organizations/${b.id}/invoices/${invoiceId}`,
    relatedEntityId: null,
  });
  expect(notificationDestination(row, a.id, () => true)).toBeNull();
  expect(
    notificationDestination(notification({ relatedEntityId: `../../${b.id}` }), a.id, () => true),
  ).toBeNull();
});
it('retains unknown future types with neutral presentation', () => {
  const row = notification({ type: 'NEW_ACTIVITY' });
  expect(parseNotificationPage(notificationPage([row]), a.id, defaultFilters).data[0]?.type).toBe(
    'NEW_ACTIVITY',
  );
  expect(notificationLabel(row.type)).toBe('Activity');
  expect(notificationLabel('SYSTEM')).toBe('System activity');
});
it.each(['INVOICE_DUE_SOON', 'INVOICE_OVERDUE'])(
  'labels %s as reminder visibility without a delivery state',
  (type) => expect(notificationLabel(type)).toContain('reminder'),
);
it('formats the original instant in the organization timezone', () => {
  expect(notificationTimestamp('2026-10-12T00:30:00.000Z', 'America/Los_Angeles')).toContain(
    'Oct 11',
  );
  expect(notificationTimestamp('2026-10-12T00:30:00.000Z', 'Asia/Kolkata')).toContain('Oct 12');
});
it('keys differ by account, organization, status, page size, direction and opaque cursor', () => {
  const key = notificationKeys.list('a', a.id, defaultFilters);
  for (const other of [
    notificationKeys.list('b', a.id, defaultFilters),
    notificationKeys.list('a', b.id, defaultFilters),
    notificationKeys.list('a', a.id, { ...defaultFilters, status: 'UNREAD' }),
    notificationKeys.list('a', a.id, { ...defaultFilters, limit: 50 }),
    notificationKeys.list('a', a.id, { ...defaultFilters, sortOrder: 'asc' }),
    notificationKeys.list('a', a.id, defaultFilters, 'opaque_next'),
  ])
    expect(other).not.toEqual(key);
});
it('invalidates all notification filters only for the selected account and tenant', () => {
  const client = new QueryClient();
  const keys = [
    notificationKeys.list('a', a.id, defaultFilters),
    notificationKeys.list('a', a.id, { ...defaultFilters, status: 'READ' }),
    notificationKeys.list('a', a.id, { ...defaultFilters, status: 'UNREAD' }, 'opaque_next'),
  ];
  const others = [
    notificationKeys.list('b', a.id, defaultFilters),
    notificationKeys.list('a', b.id, defaultFilters),
    ['organization', 'a', a.id, 'invoices'],
    ['organization', 'a', a.id, 'cash-flow'],
  ];
  for (const key of [...keys, ...others]) client.setQueryData(key, {});
  invalidateNotificationReads(client, 'a', a.id);
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  for (const key of others) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  client.clear();
});
it('permits only the implemented protected notification collection return route', () => {
  const path = `/organizations/${a.id}/notifications`;
  expect(safeReturnTo(path)).toBe(path);
  expect(safeReturnTo(`${path}/${notificationId}`)).toBe('/session');
  expect(safeReturnTo(`https://evil.test${path}`)).toBe('/session');
});
