import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SessionLoading } from '../auth/ProtectedRoute';
import { useOrganization } from './OrganizationContext';
import { OrganizationProvider } from './OrganizationProvider';
import styles from './Workspace.module.css';

const navigationGroups = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', path: 'dashboard', permission: 'analytics.read', icon: 'overview' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Customers', path: 'customers', permission: 'customer.read', icon: 'people' },
      { label: 'Invoices', path: 'invoices', permission: 'invoice.read', icon: 'document' },
      { label: 'Payments', path: 'payments', permission: 'payment.read', icon: 'payment' },
      { label: 'Expenses', path: 'expenses', permission: 'expense.read', icon: 'expense' },
    ],
  },
  {
    title: 'Financial analytics',
    items: [
      { label: 'Cash Flow', path: 'cash-flow', permission: 'analytics.read', icon: 'chart' },
      { label: 'Profit & Loss', path: 'profit-loss', permission: 'analytics.read', icon: 'chart' },
      {
        label: 'Receivables Aging',
        path: 'receivables-aging',
        permission: 'analytics.read',
        icon: 'clock',
      },
    ],
  },
  {
    title: 'Management',
    items: [
      {
        label: 'Notifications',
        path: 'notifications',
        permission: 'notification.read',
        icon: 'bell',
      },
      { label: 'Reports', path: 'reports', permission: 'report.read', icon: 'document' },
      { label: 'Audit Logs', path: 'audit-logs', permission: 'audit.read', icon: 'list' },
    ],
  },
] as const;

const iconPaths = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v1" />
    </>
  ),
  document: (
    <>
      <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" />
    </>
  ),
  payment: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20M6 15h4" />
    </>
  ),
  expense: (
    <>
      <path d="M12 3v18M7 8h7a3 3 0 0 1 0 6h-4a3 3 0 0 0 0 6h7" />
    </>
  ),
  chart: (
    <>
      <path d="M3 20h18M5 16l5-5 4 3 5-8" />
      <path d="M16 6h3v3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  bell: (
    <>
      <path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 20h4" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1" />
    </>
  ),
} as const;

function NavigationIcon({ name }: { name: keyof typeof iconPaths }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name]}
    </svg>
  );
}
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
      {navigationGroups.map((group) => {
        const visible = group.items.filter((item) =>
          item.path === 'reports'
            ? context.hasPermission('report.read') || context.hasPermission('report.export')
            : context.hasPermission(item.permission),
        );
        return visible.length ? (
          <div className={styles.navGroup} key={group.title}>
            <span className={styles.navHeading}>{group.title}</span>
            {visible.map((item) => (
              <NavLink
                key={item.path}
                to={`/organizations/${context.selectedId}/${item.path}`}
                className={({ isActive }) => (isActive ? styles.active : styles.link)}
                onClick={close}
              >
                <NavigationIcon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        ) : null;
      })}
      <div className={styles.navGroup}>
        <span className={styles.navHeading}>Organization</span>
        <NavLink
          to={context.selectedId ? `/organizations/${context.selectedId}/workspace` : '/workspace'}
          className={({ isActive }) => (isActive ? styles.active : styles.link)}
          onClick={close}
        >
          <NavigationIcon name="overview" />
          <span>Workspace</span>
        </NavLink>
      </div>
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
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              ↗
            </span>
            <span>SME Finance</span>
          </div>
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
          Create an organization to start managing your business finances, or contact an
          organization administrator about an invitation to an existing workspace.
        </p>
        <Link className={styles.createAction} to="/organizations/new">
          Create Organization
        </Link>
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
