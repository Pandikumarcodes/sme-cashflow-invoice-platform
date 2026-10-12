import type { ReactNode } from 'react';
import { ApiError } from '../../api/errors';
import { useOrganization } from '../../organizations/OrganizationContext';
import { OrganizationWorkspace, PermissionBoundary } from '../../organizations/Workspace';
import styles from './Expenses.module.css';
export function ExpenseBoundary({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const context = useOrganization();
  if (context.status !== 'ready') return <OrganizationWorkspace />;
  return <PermissionBoundary permission={permission}>{children}</PermissionBoundary>;
}
export function ExpenseError({ error, retry }: { error: unknown; retry: () => void }) {
  const api = error instanceof ApiError ? error : undefined;
  return (
    <section className={styles.panel}>
      <h2>
        {api?.status === 404
          ? 'Expense not found'
          : api?.status === 403
            ? 'Access denied'
            : 'Expenses unavailable'}
      </h2>
      <p role="alert">{api?.message ?? 'The expense request could not be completed.'}</p>
      <button onClick={retry}>Retry expense request</button>
    </section>
  );
}
