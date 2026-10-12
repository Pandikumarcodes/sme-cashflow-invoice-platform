import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SessionLoading } from '../auth/ProtectedRoute';
import { useOrganization } from './OrganizationContext';
import { OrganizationProvider } from './OrganizationProvider';
import styles from './Workspace.module.css';

const futureNavigation = [
  ['Reports', 'report.read'],
  ['Audit Logs', 'audit.read'],
  ['Settings', 'organization.update'],
] as const;
export function OrganizationShell() {
  const { user } = useAuth();
  if (!user) return <SessionLoading />;
  return (
    <OrganizationProvider key={user.id} accountId={user.id}>
      <WorkspaceLayout />
    </OrganizationProvider>
  );
}
export function PermissionBoundary({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const context = useOrganization();
  if (context.status === 'loading') return <p role="status">Checking organization access…</p>;
  if (!context.hasPermission(permission))
    return <p role="alert">Access denied. You do not have permission to view this area.</p>;
  return children;
}
export function OrganizationSwitcher({ onSwitch }: { onSwitch: () => void }) {
  const context = useOrganization();
  return (
    <div className={styles.switcher}>
      <label htmlFor="organization-switcher">Organization</label>
      <select
        id="organization-switcher"
        value={
          context.organizations.some((o) => o.id === context.selectedId) ? context.selectedId : ''
        }
        disabled={!context.organizations.length || context.status === 'loading'}
        onChange={(event) => {
          context.switchOrganization(event.target.value);
          onSwitch();
        }}
      >
        <option value="" disabled>
          {context.status === 'loading'
            ? 'Loading organizations…'
            : context.status === 'empty'
              ? 'No accessible organizations'
              : context.status === 'error' && !context.organizations.length
                ? 'Organizations unavailable'
                : 'Select an organization'}
        </option>
        {context.organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.displayName ?? o.legalName}
          </option>
        ))}
      </select>
    </div>
  );
}
function Navigation({ close }: { close?: () => void }) {
  const context = useOrganization();
  return (
    <nav aria-label="Workspace navigation">
      {context.hasPermission('analytics.read') && (
        <NavLink
          to={`/organizations/${context.selectedId}/dashboard`}
          className={({ isActive }) => (isActive ? styles.active : styles.link)}
          onClick={close}
        >
          Dashboard
        </NavLink>
      )}
      {context.hasPermission('customer.read') && (
        <NavLink
          to={`/organizations/${context.selectedId}/customers`}
          className={({ isActive }) => (isActive ? styles.active : styles.link)}
          onClick={close}
        >
          Customers
        </NavLink>
      )}
      {context.hasPermission('invoice.read') && (
        <NavLink
          to={`/organizations/${context.selectedId}/invoices`}
          className={({ isActive }) => (isActive ? styles.active : styles.link)}
          onClick={close}
        >
          Invoices
        </NavLink>
      )}
      {context.hasPermission('payment.read') && (
        <NavLink
          to={`/organizations/${context.selectedId}/payments`}
          className={({ isActive }) => (isActive ? styles.active : styles.link)}
          onClick={close}
        >
          Payments
        </NavLink>
      )}
      {context.hasPermission('expense.read') && (
        <NavLink
          to={`/organizations/${context.selectedId}/expenses`}
          className={({ isActive }) => (isActive ? styles.active : styles.link)}
          onClick={close}
        >
          Expenses
        </NavLink>
      )}
      {context.hasPermission('analytics.read') &&
        (
          [
            ['Cash Flow', 'cash-flow'],
            ['Profit & Loss', 'profit-loss'],
            ['Receivables Aging', 'receivables-aging'],
          ] as const
        ).map(([label, path]) => (
          <NavLink
            key={path}
            to={`/organizations/${context.selectedId}/${path}`}
            className={({ isActive }) => (isActive ? styles.active : styles.link)}
            onClick={close}
          >
            {label}
          </NavLink>
        ))}
      {context.hasPermission('notification.read') && (
        <NavLink
          to={`/organizations/${context.selectedId}/notifications`}
          className={({ isActive }) => (isActive ? styles.active : styles.link)}
          onClick={close}
        >
          Notifications
        </NavLink>
      )}
      <NavLink
        to={context.selectedId ? `/organizations/${context.selectedId}/workspace` : '/workspace'}
        className={({ isActive }) => (isActive ? styles.active : styles.link)}
        onClick={close}
      >
        Workspace
      </NavLink>
      {futureNavigation
        .filter(([, permission]) => context.hasPermission(permission))
        .map(([label]) => (
          <span className={styles.future} key={label} aria-disabled="true">
            {label}
            <small>Coming soon</small>
          </span>
        ))}
    </nav>
  );
}
function MobileDrawer({
  close,
  trigger,
}: {
  close: () => void;
  trigger: React.RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const media = window.matchMedia?.('(min-width: 48rem)');
    const onResize = () => {
      if (media?.matches) close();
    };
    media?.addEventListener('change', onResize);
    const button = trigger.current;
    return () => {
      document.body.style.overflow = priorOverflow;
      media?.removeEventListener('change', onResize);
      button?.focus();
    };
  }, [close, trigger]);
  return (
    <div
      className={styles.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className={styles.drawer}
        ref={dialog}
        role="dialog"
        id="workspace-navigation-drawer"
        aria-modal="true"
        aria-labelledby="drawer-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
          if (event.key !== 'Tab') return;
          const elements = dialog.current?.querySelectorAll<HTMLElement>('button, a[href]');
          const first = elements?.[0];
          const last = elements?.[elements.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className={styles.drawerHeading}>
          <h2 id="drawer-title">SME Finance</h2>
          <button onClick={close} aria-label="Close navigation">
            Close
          </button>
        </div>
        <Navigation close={close} />
      </div>
    </div>
  );
}
function WorkspaceLayout() {
  const { user, session, busy } = useAuth();
  const context = useOrganization();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // Stable callback avoids resetting drawer focus on unrelated query updates.
  const [close] = useState(() => () => setOpen(false));
  return (
    <>
      <div className={styles.shell} inert={open} aria-hidden={open || undefined}>
        <a className={styles.skip} href="#workspace-main">
          Skip to workspace
        </a>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>SME Finance</div>
          <Navigation />
        </aside>
        <div className={styles.content}>
          <header className={styles.header}>
            <button
              className={styles.menu}
              ref={trigger}
              aria-label="Open navigation"
              aria-expanded={open}
              aria-controls={open ? 'workspace-navigation-drawer' : undefined}
              onClick={() => setOpen(true)}
            >
              Menu
            </button>
            <OrganizationSwitcher onSwitch={close} />
            <div className={styles.account}>
              <span>
                {user?.firstName} {user?.lastName}
              </span>
              <button
                disabled={busy}
                onClick={() => {
                  context.clearSelection();
                  close();
                  const pending = session.logout();
                  void navigate('/login', { replace: true });
                  void pending;
                }}
              >
                Sign out
              </button>
            </div>
          </header>
          <main id="workspace-main" tabIndex={-1} className={styles.main}>
            <Outlet />
          </main>
        </div>
      </div>
      {open && <MobileDrawer close={close} trigger={trigger} />}
    </>
  );
}
export function OrganizationWorkspace() {
  const context = useOrganization();
  if (context.status === 'loading')
    return (
      <section className={styles.card} role="status">
        Checking organization access…
      </section>
    );
  if (context.status === 'empty')
    return (
      <section className={styles.card}>
        <h1>No organizations yet</h1>
        <p>
          Your account has no active organization memberships. Contact an organization administrator
          about an invitation.
        </p>
      </section>
    );
  if (context.status !== 'ready')
    return (
      <section className={styles.card}>
        <h1>
          {context.status === 'inaccessible'
            ? 'Organization unavailable'
            : context.status === 'forbidden'
              ? 'Access denied'
              : 'Unable to load organizations'}
        </h1>
        <p role="alert">
          {context.status === 'inaccessible'
            ? 'This organization is unavailable to your account. Choose another accessible organization.'
            : context.status === 'forbidden'
              ? 'You do not have permission to access this organization.'
              : 'Organization access could not be verified. Please try again.'}
        </p>
        <button onClick={context.retry}>Retry access check</button>
      </section>
    );
  const organization = context.organization!;
  return (
    <PermissionBoundary permission="organization.read">
      <section className={styles.card}>
        <p className={styles.eyebrow}>Organization workspace</p>
        <h1>{organization.displayName ?? organization.legalName}</h1>
        <p>Your organization context is ready. Business modules will arrive in later milestones.</p>
        <dl className={styles.details}>
          <div>
            <dt>Base currency</dt>
            <dd>{organization.baseCurrency}</dd>
          </div>
          <div>
            <dt>Timezone</dt>
            <dd>{organization.timezone}</dd>
          </div>
          <div>
            <dt>Membership role</dt>
            <dd>{organization.membership.role}</dd>
          </div>
        </dl>
      </section>
    </PermissionBoundary>
  );
}
