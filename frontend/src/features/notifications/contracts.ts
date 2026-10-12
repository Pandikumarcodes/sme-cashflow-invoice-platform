import { z } from 'zod';
import { ApiError } from '../../api/errors';
import { organizationIdPattern } from '../../organizations/contracts';
const uuid = z.string().regex(organizationIdPattern);
const instant = z.iso.datetime({ offset: true });
export const notificationSchema = z
  .object({
    id: uuid,
    organizationId: uuid,
    // Unknown future types retain readable content and a neutral Activity label.
    type: z.string().regex(/^[A-Z][A-Z0-9_]{0,49}$/),
    status: z.enum(['UNREAD', 'READ', 'ARCHIVED']),
    title: z.string().min(1).max(200),
    body: z.string().max(2000),
    relatedEntityType: z.string().max(50).nullable(),
    relatedEntityId: uuid.nullable(),
    scheduledAt: instant.nullable(),
    readAt: instant.nullable(),
    archivedAt: instant.nullable(),
    createdAt: instant,
    updatedAt: instant,
  })
  .superRefine((row, context) => {
    if (
      (row.status === 'UNREAD' && row.readAt !== null) ||
      (row.status === 'READ' && row.readAt === null) ||
      (row.status === 'ARCHIVED' ? row.archivedAt === null : row.archivedAt !== null)
    )
      context.addIssue({ code: 'custom', message: 'Invalid notification state.' });
  });
export type Notification = z.infer<typeof notificationSchema>;
export type NotificationAction = 'read' | 'archive';
export type NotificationFilters = {
  status: '' | 'UNREAD' | 'READ' | 'ARCHIVED';
  limit: 25 | 50 | 100;
  sortOrder: 'asc' | 'desc';
};
export const defaultFilters: NotificationFilters = { status: '', limit: 25, sortOrder: 'desc' };
const cursor = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+$/);
const pageSchema = z.object({
  data: z.array(notificationSchema),
  meta: z.object({
    limit: z.number().int().min(1).max(100),
    hasMore: z.boolean(),
    nextCursor: cursor.nullable(),
  }),
});
export type NotificationPage = z.infer<typeof pageSchema>;
function invalid(): never {
  throw new ApiError(
    'The notification response could not be verified.',
    'INVALID_RESPONSE',
    undefined,
    'invalid-response',
  );
}
export function parseNotificationPage(
  body: unknown,
  org: string,
  filters: NotificationFilters,
): NotificationPage {
  const result = pageSchema.safeParse(body);
  if (!result.success) return invalid();
  const page = result.data;
  if (
    page.meta.limit !== filters.limit ||
    page.data.length > filters.limit ||
    new Set(page.data.map((row) => row.id)).size !== page.data.length ||
    page.meta.hasMore !== (page.meta.nextCursor !== null) ||
    (page.meta.hasMore && page.data.length !== filters.limit) ||
    page.data.some(
      (row) =>
        row.organizationId !== org ||
        (filters.status ? row.status !== filters.status : row.status === 'ARCHIVED'),
    )
  )
    return invalid();
  if (
    page.data.some((row, index) => {
      if (!index) return false;
      const previous = page.data[index - 1]!;
      const difference = Date.parse(row.createdAt) - Date.parse(previous.createdAt);
      const order = difference || row.id.localeCompare(previous.id);
      return filters.sortOrder === 'asc' ? order <= 0 : order >= 0;
    })
  )
    return invalid();
  return page;
}
export function parseNotificationCommand(
  body: unknown,
  org: string,
  id: string,
  action: NotificationAction,
) {
  const result = z.object({ data: notificationSchema }).safeParse(body);
  if (
    !result.success ||
    result.data.data.organizationId !== org ||
    result.data.data.id !== id ||
    (action === 'archive'
      ? result.data.data.status !== 'ARCHIVED'
      : result.data.data.status === 'UNREAD')
  )
    return invalid();
  return result.data.data;
}
