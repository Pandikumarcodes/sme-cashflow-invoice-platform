import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useOrganization } from '../../organizations/OrganizationContext';
import { notificationTimestamp } from '../notifications/presentation';
import { ReportBoundary, Loading, ReadError, Pagination } from '../reports/presentation';
import { auditDestination } from './presentation';
import { defaultFilters, auditFilterError, type AuditFilters } from './contracts';
import { useAudit } from './queries';
import styles from '../reports/Reports.module.css';
export function AuditLogsPage() {
  const context = useOrganization();
  return (
    <ReportBoundary permission="audit.read">
      {context.organization && <AuditLogs key={context.organization.id} />}
    </ReportBoundary>
  );
}
function AuditLogs() {
  const context = useOrganization();
  const org = context.organization!;
  const [draft, setDraft] = useState({ ...defaultFilters });
  const [filters, setFilters] = useState({ ...defaultFilters });
  const [error, setError] = useState<string>();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const list = useAudit(org.id, filters, cursors.at(-1));
  const data = !list.isFetching && !list.isError ? list.data : undefined;
  const labels = {
    actorUserId: 'Actor user ID',
    action: 'Exact action',
    entityType: 'Exact entity type',
    entityId: 'Entity ID',
    occurredFrom: 'Occurred from',
    occurredTo: 'Occurred to',
  };
  return (
    <div className={styles.page}>
      <header>
        <h1>Audit Logs</h1>
        <p>
          Read-only organization history. Actor names are not exposed; identifiers refer to
          historical records.
        </p>
      </header>
      <section className={styles.panel}>
        <form
          className={styles.controls}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const failure = auditFilterError(draft);
            setError(failure);
            if (!failure) {
              setFilters({ ...draft });
              setCursors([undefined]);
            }
          }}
        >
          {(Object.keys(labels) as (keyof typeof labels)[]).map((field) => (
            <label key={field}>
              {labels[field]}
              <input
                value={draft[field]}
                type={field.startsWith('occurred') ? 'date' : 'text'}
                maxLength={
                  field === 'action'
                    ? 100
                    : field === 'entityType'
                      ? 50
                      : field.endsWith('Id')
                        ? 36
                        : undefined
                }
                onChange={(event) => setDraft((old) => ({ ...old, [field]: event.target.value }))}
              />
            </label>
          ))}
          <label>
            Audit order
            <select
              value={draft.sortOrder}
              onChange={(event) =>
                setDraft((old) => ({
                  ...old,
                  sortOrder: event.target.value as AuditFilters['sortOrder'],
                }))
              }
            >
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </label>
          <label>
            Audit rows per page
            <select
              value={draft.limit}
              onChange={(event) =>
                setDraft((old) => ({
                  ...old,
                  limit: Number(event.target.value) as AuditFilters['limit'],
                }))
              }
            >
              {[25, 50, 100].map((limit) => (
                <option key={limit}>{limit}</option>
              ))}
            </select>
          </label>
          <button>Apply audit filters</button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              setDraft({ ...defaultFilters });
              setFilters({ ...defaultFilters });
              setCursors([undefined]);
              setError(undefined);
            }}
          >
            Clear audit filters
          </button>
          <button
            type="button"
            className={styles.secondary}
            disabled={list.isFetching}
            onClick={() => {
              void list.refetch();
            }}
          >
            Refresh audit history
          </button>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </form>
        <p className={styles.note}>
          Dates filter UTC event instants using {org.timezone} calendar-day boundaries, including
          the end day. Either bound may be omitted; two-sided ranges allow 1,825 inclusive days. New
          events appear on refresh; pages are not a fixed snapshot.
        </p>
      </section>
      {list.isPending || list.isFetching ? (
        <Loading />
      ) : list.isError ? (
        <ReadError
          error={list.error}
          retry={() => {
            void list.refetch();
          }}
          restart={() => setCursors([undefined])}
        />
      ) : (
        data && (
          <>
            <section className={styles.panel}>
              <h2>Organization activity</h2>
              {!data.data.length && <p>No audit entries match these filters.</p>}
              <ul className={styles.cards} aria-label="Audit history">
                {data.data.map((row) => {
                  const destination = auditDestination(row, org.id, context.hasPermission);
                  return (
                    <li className={styles.card} key={row.id}>
                      <article aria-label={row.action}>
                        <h3>{row.action}</h3>
                        <p>
                          {row.actorType} · {row.outcome} · {row.source}
                        </p>
                        <time dateTime={row.occurredAt} title={row.occurredAt}>
                          {notificationTimestamp(row.occurredAt, org.timezone)}
                        </time>
                        <dl className={styles.facts}>
                          <div>
                            <dt>Actor user ID</dt>
                            <dd>{row.actorUserId ?? 'No human actor'}</dd>
                          </div>
                          <div>
                            <dt>Membership ID</dt>
                            <dd>{row.actorMembershipId ?? 'Not recorded'}</dd>
                          </div>
                          <div>
                            <dt>Resource</dt>
                            <dd>
                              {row.entityType} ·{' '}
                              {row.entityId ?? 'Historical identifier unavailable'}
                            </dd>
                          </div>
                        </dl>
                        {destination && <Link to={destination}>Open related resource</Link>}
                        <details>
                          <summary>View safe event details</summary>
                          <p>
                            Changed fields:{' '}
                            {row.changedFields.length
                              ? row.changedFields.join(', ')
                              : 'No displayed changes'}
                          </p>
                          {(['beforeData', 'afterData'] as const).map((key) => (
                            <div key={key}>
                              <h4>{key === 'beforeData' ? 'Before' : 'After'}</h4>
                              {row[key] ? (
                                <dl className={styles.facts}>
                                  {Object.entries(row[key]!).map(([field, value]) => (
                                    <div key={field}>
                                      <dt>{field}</dt>
                                      <dd>{value === null ? 'Not recorded' : String(value)}</dd>
                                    </div>
                                  ))}
                                </dl>
                              ) : (
                                <p>No displayed data.</p>
                              )}
                            </div>
                          ))}
                          {row.requestId && <p>Request ID: {row.requestId}</p>}
                          {row.correlationId && <p>Correlation ID: {row.correlationId}</p>}
                          <p className={styles.note}>
                            A bounded non-personal field selection is shown; nested payloads,
                            arbitrary metadata and personal contact details are omitted. Historical
                            resource links may return not found.
                          </p>
                        </details>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </section>
            <Pagination
              page={cursors.length}
              hasPrevious={cursors.length > 1}
              hasNext={data.meta.hasMore}
              previous={() => setCursors((old) => old.slice(0, -1))}
              next={() => setCursors((old) => [...old, data.meta.nextCursor!])}
            />
          </>
        )
      )}
    </div>
  );
}
