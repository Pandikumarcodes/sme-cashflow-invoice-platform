import type { ReactNode } from 'react';
import { ApiError } from '../../api/errors';
import { useOrganization } from '../../organizations/OrganizationContext';
import { OrganizationWorkspace } from '../../organizations/Workspace';

import styles from './Reports.module.css';
export function ReportBoundary({
  permission,
  children,
}: {
  permission: 'reports' | 'audit.read';
  children: ReactNode;
}) {
  const context = useOrganization();
  if (context.status !== 'ready') return <OrganizationWorkspace />;
  if (
    permission === 'reports'
      ? !context.hasPermission('report.read') && !context.hasPermission('report.export')
      : !context.hasPermission(permission)
  )
    return <p role="alert">Access denied. You do not have permission to view this area.</p>;
  return children;
}
export function Loading() {
  return (
    <section className={styles.panel} role="status" aria-busy="true">
      <p>Loading records…</p>
      <div className={styles.skeleton} aria-hidden="true" />
    </section>
  );
}
export function ReadError({
  error,
  retry,
  restart,
}: {
  error: unknown;
  retry: () => void;
  restart?: () => void;
}) {
  return (
    <section className={styles.panel}>
      <p role="alert">
        {error instanceof ApiError ? error.message : 'Records could not be loaded.'}
      </p>
      <button onClick={retry}>Retry records</button>
      {error instanceof ApiError && error.code === 'INVALID_CURSOR' && restart && (
        <button className={styles.secondary} onClick={restart}>
          Restart list
        </button>
      )}
    </section>
  );
}
export function Pagination({
  previous,
  next,
  hasPrevious,
  hasNext,
  page,
}: {
  previous: () => void;
  next: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  page: number;
}) {
  return (
    <nav className={styles.actions} aria-label="Record pagination">
      <button className={styles.secondary} disabled={!hasPrevious} onClick={previous}>
        Previous records
      </button>
      <span>Page {page}</span>
      <button className={styles.secondary} disabled={!hasNext} onClick={next}>
        Next records
      </button>
    </nav>
  );
}
