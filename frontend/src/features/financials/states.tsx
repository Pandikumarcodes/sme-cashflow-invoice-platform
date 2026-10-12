import type { ReactNode } from 'react';
import { ApiError } from '../../api/errors';
import { useOrganization } from '../../organizations/OrganizationContext';
import { OrganizationWorkspace, PermissionBoundary } from '../../organizations/Workspace';
import styles from './Financials.module.css';
export function FinancialBoundary({ children }: { children: ReactNode }) {
  const context = useOrganization();
  return context.status !== 'ready' ? (
    <OrganizationWorkspace />
  ) : (
    <PermissionBoundary permission="analytics.read">{children}</PermissionBoundary>
  );
}
export function FinancialLoading() {
  return (
    <section className={styles.panel} role="status" aria-busy="true">
      <p>Loading financial report…</p>
      <div className={styles.skeleton} aria-hidden="true" />
    </section>
  );
}
export function FinancialError({ error, retry }: { error: unknown; retry: () => void }) {
  const api = error instanceof ApiError ? error : undefined;
  return (
    <section className={styles.panel}>
      <h2>
        {api?.status === 403
          ? 'Access denied'
          : api?.status === 404
            ? 'Financial report unavailable'
            : 'Financial report error'}
      </h2>
      <p role="alert">{api?.message ?? 'The financial report could not be loaded.'}</p>
      <button onClick={retry}>Retry financial report</button>
    </section>
  );
}
export function Metrics({
  values,
  currency,
}: {
  values: {
    label: string;
    amount: string;
    tone?: 'positive' | 'negative' | 'warning' | 'neutral';
  }[];
  currency: string;
}) {
  return (
    <section className={styles.metrics} aria-label="Financial report summary">
      {values.map((value) => (
        <article key={value.label} className={styles.metric}>
          <h2>{value.label}</h2>
          <p className={styles[value.tone ?? 'neutral']}>
            {value.amount} <small>{currency}</small>
          </p>
        </article>
      ))}
    </section>
  );
}
