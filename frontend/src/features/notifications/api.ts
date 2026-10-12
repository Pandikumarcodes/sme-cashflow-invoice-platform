import type { Session } from '../../auth/session';
import {
  parseNotificationPage,
  parseNotificationCommand,
  type NotificationFilters,
  type NotificationAction,
} from './contracts';
export async function listNotifications(
  session: Session,
  org: string,
  filters: NotificationFilters,
  after: string | undefined,
  signal: AbortSignal,
) {
  return parseNotificationPage(
    (
      await session.request(`/organizations/${org}/notifications`, {
        query: {
          limit: String(filters.limit),
          sortBy: 'createdAt',
          sortOrder: filters.sortOrder,
          ...(filters.status ? { status: filters.status } : {}),
          ...(after ? { after } : {}),
        },
        signal,
      })
    ).body,
    org,
    filters,
  );
}
export async function changeNotification(
  session: Session,
  org: string,
  id: string,
  action: NotificationAction,
  signal: AbortSignal,
) {
  return parseNotificationCommand(
    (
      await session.request(`/organizations/${org}/notifications/${id}/${action}`, {
        method: 'POST',
        body: {},
        signal,
      })
    ).body,
    org,
    id,
    action,
  );
}
