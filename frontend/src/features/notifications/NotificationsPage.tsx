import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, isAbortError } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { useOrganization } from '../../organizations/OrganizationContext';
import { OrganizationWorkspace, PermissionBoundary } from '../../organizations/Workspace';
import {
  defaultFilters,
  type Notification,
  type NotificationFilters,
  type NotificationAction,
} from './contracts';
import { notificationDestination, notificationLabel, notificationTimestamp } from './presentation';
import { useNotifications, useNotificationCommand, invalidateNotificationReads } from './queries';
import styles from './Notifications.module.css';
export function NotificationsPage() {
  const context = useOrganization();
  if (context.status !== 'ready') return <OrganizationWorkspace />;
  return (
    <PermissionBoundary permission="notification.read">
      <Inbox key={context.organization!.id} />
    </PermissionBoundary>
  );
}
function Inbox() {
  const context = useOrganization();
  const org = context.organization!;
  const [filters, setFilters] = useState({ ...defaultFilters });
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [confirmation, setConfirmation] = useState('');
  const list = useNotifications(org.id, filters, cursors.at(-1));
  const data = !list.isFetching && !list.isError ? list.data : undefined;
  const change = (values: Partial<NotificationFilters>) => {
    setFilters((old) => ({ ...old, ...values }));
    setCursors([undefined]);
    setConfirmation('');
  };
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>Notifications</h1>
        <p>Stay informed about important activity in your workspace.</p>
      </header>
      <div className={styles.controls}>
        <label>
          Notification state
          <select
            value={filters.status}
            onChange={(event) =>
              change({ status: event.target.value as NotificationFilters['status'] })
            }
          >
            <option value="">Inbox (unread and read)</option>
            <option value="UNREAD">Unread</option>
            <option value="READ">Read</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </label>
        <label>
          Created order
          <select
            value={filters.sortOrder}
            onChange={(event) =>
              change({ sortOrder: event.target.value as NotificationFilters['sortOrder'] })
            }
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </label>
        <label>
          Notifications per page
          <select
            value={filters.limit}
            onChange={(event) =>
              change({ limit: Number(event.target.value) as NotificationFilters['limit'] })
            }
          >
            {[25, 50, 100].map((limit) => (
              <option key={limit} value={limit}>
                {limit}
              </option>
            ))}
          </select>
        </label>
        <button
          className={styles.secondary}
          disabled={list.isFetching}
          onClick={() => {
            setConfirmation('');
            void list.refetch();
          }}
        >
          Refresh inbox
        </button>
      </div>
      <p className={styles.note}>
        Your notifications only. Refresh for the latest activity; unread counts cover this page.
      </p>
      {confirmation && <p role="status">{confirmation}</p>}
      {list.isPending || list.isFetching ? (
        <section className={styles.panel} role="status" aria-busy="true">
          <p>Loading notifications…</p>
          <div className={styles.skeleton} aria-hidden="true" />
        </section>
      ) : list.isError ? (
        <section className={styles.panel}>
          <h2>
            {list.error instanceof ApiError && list.error.status === 403
              ? 'Access denied'
              : 'Notifications unavailable'}
          </h2>
          <p role="alert">
            {list.error instanceof ApiError ? list.error.message : 'The inbox could not be loaded.'}
          </p>
          <button
            onClick={() => {
              void list.refetch();
            }}
          >
            Retry notifications
          </button>
          {list.error instanceof ApiError && list.error.code === 'INVALID_CURSOR' && (
            <button className={styles.secondary} onClick={() => setCursors([undefined])}>
              Restart notification list
            </button>
          )}
        </section>
      ) : (
        data && (
          <>
            <p className={styles.counts} aria-live="polite">
              Unread on this page: {data.data.filter((row) => row.status === 'UNREAD').length}.
              Loaded notifications: {data.data.length}.
            </p>
            {!data.data.length && (
              <section className={styles.panel}>
                <h2>
                  {filters.status === 'UNREAD'
                    ? 'No unread notifications'
                    : filters.status === 'READ'
                      ? 'No read notifications'
                      : filters.status === 'ARCHIVED'
                        ? 'No archived notifications'
                        : 'You’re all caught up'}
                </h2>
                <p>Refresh to check for new activity in your inbox.</p>
              </section>
            )}
            <ul className={styles.list} aria-label="Notification inbox">
              {data.data.map((row) => (
                <li key={row.id}>
                  <NotificationItem
                    row={row}
                    confirmed={(message) => {
                      setConfirmation(message);
                      setCursors([undefined]);
                    }}
                  />
                </li>
              ))}
            </ul>
            <nav className={styles.pagination} aria-label="Notification pagination">
              <button
                className={styles.secondary}
                disabled={cursors.length === 1}
                onClick={() => {
                  setCursors((old) => old.slice(0, -1));
                  setConfirmation('');
                }}
              >
                Previous notifications
              </button>
              <span>Page {cursors.length}</span>
              <button
                className={styles.secondary}
                disabled={!data.meta.hasMore}
                onClick={() => {
                  setCursors((old) => [...old, data.meta.nextCursor!]);
                  setConfirmation('');
                }}
              >
                Next notifications
              </button>
            </nav>
          </>
        )
      )}
    </div>
  );
}
function NotificationItem({
  row,
  confirmed,
}: {
  row: Notification;
  confirmed: (message: string) => void;
}) {
  const context = useOrganization();
  const org = context.organization!;
  const { user } = useAuth();
  const client = useQueryClient();
  const command = useNotificationCommand(org.id);
  const lock = useRef(false);
  const [error, setError] = useState<string>();
  const [archive, setArchive] = useState(false);
  const archiveTrigger = useRef<HTMLButtonElement>(null);
  const archiveConfirm = useRef<HTMLButtonElement>(null);
  const wasArchive = useRef(false);
  useEffect(() => {
    if (archive) archiveConfirm.current?.focus();
    else if (wasArchive.current) archiveTrigger.current?.focus();
    wasArchive.current = archive;
  }, [archive]);
  const destination = notificationDestination(row, org.id, context.hasPermission);
  const writable = context.hasPermission('notification.update_self');
  async function submit(action: NotificationAction) {
    if (lock.current || !writable) return;
    lock.current = true;
    setError(undefined);
    try {
      const result = await command.mutateAsync({ id: row.id, action });
      if (!command.isCurrent()) return;
      setArchive(false);
      invalidateNotificationReads(client, user!.id, org.id);
      confirmed(
        result.status === 'ARCHIVED' ? 'Notification archived.' : 'Notification marked as read.',
      );
    } catch (failure) {
      if (!isAbortError(failure) && command.isCurrent())
        setError(
          failure instanceof ApiError
            ? failure.kind === 'network' ||
              failure.kind === 'invalid-response' ||
              (failure.status ?? 0) >= 500
              ? 'The change could not be confirmed. These actions are repeat-safe; refresh the inbox or explicitly retry.'
              : failure.message
            : 'The change could not be confirmed. Refresh the inbox or retry.',
        );
    } finally {
      lock.current = false;
    }
  }
  const time = (label: string, value: string) => (
    <span>
      {label}:{' '}
      <time dateTime={value} title={value}>
        {notificationTimestamp(value, org.timezone)}
      </time>
    </span>
  );
  return (
    <article
      className={`${styles.item} ${row.status === 'UNREAD' ? styles.unread : ''}`}
      aria-label={row.title}
    >
      <div className={styles.itemHeading}>
        <h2>{row.title}</h2>
        <span className={styles.state}>
          {row.status === 'UNREAD' ? 'Unread' : row.status === 'READ' ? 'Read' : 'Archived'}
        </span>
      </div>
      <p className={styles.body}>{row.body}</p>
      <div className={styles.meta}>
        <span>{notificationLabel(row.type)}</span>
        {time('Created', row.createdAt)}
        {row.scheduledAt && time('Scheduled', row.scheduledAt)}
        {row.readAt && time('Read', row.readAt)}
        {row.archivedAt && time('Archived', row.archivedAt)}
        <span>{org.timezone}</span>
      </div>
      <div className={styles.actions}>
        {destination && (
          <Link to={destination}>Open related {row.relatedEntityType?.toLowerCase()}</Link>
        )}
        {writable && row.status === 'UNREAD' && (
          <button
            disabled={command.isPending}
            aria-label={`Mark ${row.title} as read`}
            onClick={() => {
              void submit('read');
            }}
          >
            Mark as read
          </button>
        )}
        {writable &&
          row.status !== 'ARCHIVED' &&
          (archive ? (
            <div
              className={styles.actions}
              role="group"
              aria-label={`Archive ${row.title} confirmation`}
            >
              <span>Archiving is permanent; it cannot be restored to the inbox.</span>
              <button
                ref={archiveConfirm}
                disabled={command.isPending}
                aria-label={`Confirm archive ${row.title}`}
                onClick={() => {
                  void submit('archive');
                }}
              >
                Confirm archive
              </button>
              <button
                className={styles.secondary}
                disabled={command.isPending}
                onClick={() => setArchive(false)}
              >
                Keep in inbox
              </button>
            </div>
          ) : (
            <button
              ref={archiveTrigger}
              className={styles.secondary}
              disabled={command.isPending}
              aria-label={`Archive ${row.title}`}
              onClick={() => setArchive(true)}
            >
              Archive
            </button>
          ))}
      </div>
      {command.isPending && <p role="status">Updating notification…</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </article>
  );
}
