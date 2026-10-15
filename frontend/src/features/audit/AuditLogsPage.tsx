import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useOrganization } from '../../organizations/OrganizationContext';
import { notificationTimestamp } from '../notifications/presentation';
import { ReportBoundary, Loading, ReadError, Pagination } from '../reports/presentation';
import { auditDestination, auditActionLabel, auditResourceLabel } from './presentation';
import { defaultFilters, auditFilterError, type AuditFilters } from './contracts';
import { useAudit } from './queries';
import styles from './AuditLogs.module.css';
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
        <p>Review recorded activity across your organization.</p>
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
          {(['occurredFrom', 'occurredTo'] as const).map((field) => (
            <label key={field}>
              {labels[field]}
              <input
                value={draft[field]}
                type={field.startsWith('occurred') ? 'date' : 'text'}
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
          <details className={styles.filterDetails}>
            <summary>
              Exact-match filters
              {[draft.actorUserId, draft.action, draft.entityType, draft.entityId].some(Boolean)
                ? ' (set)'
                : ''}
            </summary>
            <div className={styles.exactFilters}>
              {(['action', 'entityType', 'actorUserId', 'entityId'] as const).map((field) => (
                <label key={field}>
                  {labels[field]}
                  <input
                    value={draft[field]}
                    maxLength={field === 'action' ? 100 : field === 'entityType' ? 50 : 36}
                    onChange={(event) =>
                      setDraft((old) => ({ ...old, [field]: event.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            <p className={styles.note}>
              Use original action codes and resource types for exact matches.
            </p>
          </details>
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
          Dates use {org.timezone}, including the end day. Either date is optional; ranges allow up
          to 1,825 days. Refresh for new activity.
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
              <div className={styles.sectionHeading}>
                <h2>Organization activity</h2>
                <span>Read-only history | {org.timezone}</span>
              </div>
              {!data.data.length && <p>No audit entries match these filters.</p>}
              <ul className={styles.cards} aria-label="Audit history">
                {data.data.map((row) => {
                  const destination = auditDestination(row, org.id, context.hasPermission);
                  return (
                    <li className={styles.card} key={row.id}>
                      <article aria-label={auditActionLabel(row.action)}>
                        <div className={styles.recordHeading}>
                          <h3>{auditActionLabel(row.action)}</h3>
                          <time dateTime={row.occurredAt} title={row.occurredAt}>
                            {notificationTimestamp(row.occurredAt, org.timezone)}
                          </time>
                        </div>
                        <div className={styles.recordMeta}>
                          <span>
                            {row.actorType === 'USER'
                              ? 'User activity'
                              : row.actorType === 'WORKER'
                                ? 'Background worker'
                                : 'System activity'}
                          </span>
                          <span>{auditResourceLabel(row.entityType)}</span>
                          <span className={styles.outcome} data-outcome={row.outcome}>
                            {row.outcome === 'SUCCESS'
                              ? 'Succeeded'
                              : row.outcome === 'DENIED'
                                ? 'Denied'
                                : 'Failed'}
                          </span>
                        </div>
                        <p className={styles.note}>
                          {row.changedFields.length
                            ? 'Changed fields: ' + row.changedFields.join(', ')
                            : 'No displayed changes'}
                        </p>
                        {destination && <Link to={destination}>Open related resource</Link>}
                        <details className={styles.eventDetails}>
                          <summary>View safe event details</summary>
                          <dl className={styles.facts}>
                            {[
                              ['Original action code', row.action],
                              ['Resource type', row.entityType],
                              [
                                'Resource identifier',
                                row.entityId ?? 'Historical identifier unavailable',
                              ],
                              ['Actor user ID', row.actorUserId ?? 'No human actor'],
                              ['Membership ID', row.actorMembershipId ?? 'Not recorded'],
                              ['Source', row.source],
                            ].map(([label, value]) => (
                              <div key={label}>
                                <dt>{label}</dt>
                                <dd>{value}</dd>
                              </div>
                            ))}
                          </dl>
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
