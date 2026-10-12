import type { Notification } from './contracts';
import { dashboardOrg } from '../dashboard/test-fixtures';
export const notificationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const invoiceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const instant = '2026-10-12T10:00:00.000Z';
export function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: notificationId,
    organizationId: dashboardOrg.id,
    type: 'INVOICE_OVERDUE',
    status: 'UNREAD',
    title: 'Invoice overdue',
    body: 'Invoice INV-001 has an outstanding balance.',
    relatedEntityType: 'Invoice',
    relatedEntityId: invoiceId,
    scheduledAt: instant,
    readAt: null,
    archivedAt: null,
    createdAt: instant,
    updatedAt: instant,
    ...overrides,
  };
}
export function notificationPage(
  rows: Notification[],
  limit = 25,
  nextCursor: string | null = null,
) {
  return { data: rows, meta: { limit, hasMore: nextCursor !== null, nextCursor } };
}
export function readNotification(overrides: Partial<Notification> = {}) {
  return notification({
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    type: 'PAYMENT_RECORDED',
    title: 'Payment recorded',
    status: 'READ',
    readAt: instant,
    relatedEntityType: 'Payment',
    relatedEntityId: invoiceId,
    createdAt: '2026-10-11T10:00:00.000Z',
    scheduledAt: null,
    ...overrides,
  });
}
