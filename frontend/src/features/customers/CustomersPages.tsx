import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/errors';
import { useOrganization } from '../../organizations/OrganizationContext';
import { OrganizationWorkspace, PermissionBoundary } from '../../organizations/Workspace';
import { organizationIdPattern } from '../../organizations/contracts';
import { useCustomerDetail, useCustomerList } from './queries';
import type { CustomerFilters } from './contracts';
import { CustomerForm } from './CustomerForm';
import { ArchiveDialog } from './ArchiveDialog';
import styles from './Customers.module.css';

function CustomerBoundary({ permission, children }: { permission: string; children: ReactNode }) {
  const context = useOrganization();
  if (context.status !== 'ready') return <OrganizationWorkspace />;
  return <PermissionBoundary permission={permission}>{children}</PermissionBoundary>;
}
function CustomerError({ error, retry }: { error: unknown; retry: () => void }) {
  const api = error instanceof ApiError ? error : undefined;
  return (
    <section className={styles.panel}>
      <h2>
        {api?.status === 404
          ? 'Customer not found'
          : api?.status === 403
            ? 'Access denied'
            : 'Customers unavailable'}
      </h2>
      <p role="alert" className={styles.error}>
        {api?.message ?? 'The customer request could not be completed. Please try again.'}
      </p>
      <button type="button" className={styles.secondary} onClick={retry}>
        Retry customer request
      </button>
    </section>
  );
}
export function CustomersListPage() {
  const context = useOrganization();
  return (
    <CustomerBoundary permission="customer.read">
      {context.organization && (
        <CustomerList key={context.organization.id} organizationId={context.organization.id} />
      )}
    </CustomerBoundary>
  );
}
function CustomerList({ organizationId }: { organizationId: string }) {
  const context = useOrganization();
  const [input, setInput] = useState('');
  const [filters, setFilters] = useState<CustomerFilters>({
    status: 'ACTIVE',
    search: '',
    sortBy: 'displayName',
    sortOrder: 'asc',
    limit: 25,
  });
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const validSearch =
    input === '' ||
    (Array.from(input).length >= 2 && Array.from(input).length <= 100 && /\S/.test(input));
  useEffect(() => {
    if (input === filters.search || !validSearch) return;
    const timer = window.setTimeout(() => {
      setFilters((previous) => ({ ...previous, search: input }));
      setCursors([undefined]);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [input, filters.search, validSearch]);
  const settling = input !== filters.search;
  const list = useCustomerList(organizationId, filters, cursors.at(-1), validSearch && !settling);
  const change = (values: Partial<CustomerFilters>) => {
    setFilters((previous) => ({ ...previous, ...values }));
    setCursors([undefined]);
  };
  const base = `/organizations/${organizationId}/customers`;
  const data =
    !list.isError && !list.isFetching && !settling && validSearch ? list.data : undefined;
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <p>{context.organization?.displayName ?? context.organization?.legalName}</p>
          <h1>Customers</h1>
          <p>Manage customer identity and contact details.</p>
        </div>
        {context.hasPermission('customer.create') && (
          <Link className={styles.primary} to={`${base}/new`}>
            Add customer
          </Link>
        )}
      </header>
      <section className={styles.panel} aria-label="Customer filters">
        <div className={styles.filters}>
          <div className={styles.field}>
            <label htmlFor="customer-search">Search customers</label>
            <input
              id="customer-search"
              type="search"
              value={input}
              maxLength={100}
              aria-describedby="search-help"
              aria-invalid={!validSearch}
              onChange={(event) => setInput(event.target.value)}
            />
            <small id="search-help">Search names or email addresses using 2–100 characters.</small>
          </div>
          <div className={styles.field}>
            <label htmlFor="customer-status">Status</label>
            <select
              id="customer-status"
              value={filters.status}
              onChange={(event) =>
                change({ status: event.target.value as CustomerFilters['status'] })
              }
            >
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="customer-sort">Sort by</label>
            <select
              id="customer-sort"
              value={filters.sortBy}
              onChange={(event) =>
                change({ sortBy: event.target.value as CustomerFilters['sortBy'] })
              }
            >
              <option value="displayName">Display name</option>
              <option value="createdAt">Created date</option>
              <option value="updatedAt">Updated date</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="customer-order">Sort order</label>
            <select
              id="customer-order"
              value={filters.sortOrder}
              onChange={(event) =>
                change({ sortOrder: event.target.value as CustomerFilters['sortOrder'] })
              }
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="customer-limit">Page size</label>
            <select
              id="customer-limit"
              value={filters.limit}
              onChange={(event) => change({ limit: Number(event.target.value) })}
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
        </div>
      </section>
      {!validSearch ? (
        <p role="status">Enter 2–100 nonblank characters to search, or clear the search.</p>
      ) : settling || list.isPending || list.isFetching ? (
        <p role="status" className={styles.panel}>
          Loading customers…
        </p>
      ) : list.isError ? (
        <>
          <CustomerError
            error={list.error}
            retry={() => {
              void list.refetch();
            }}
          />
          {list.error instanceof ApiError && list.error.code === 'INVALID_CURSOR' && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setCursors([undefined]);
              }}
            >
              Restart pagination
            </button>
          )}
        </>
      ) : (
        data && (
          <section className={styles.panel} aria-label="Customer results">
            {!data.data.length ? (
              <p role="status">
                {filters.search
                  ? 'No customers match this search.'
                  : filters.status === 'ARCHIVED'
                    ? 'No archived customers.'
                    : cursors.length > 1
                      ? 'No customers on this page. Return to the previous page.'
                      : 'No active customers yet.'}
              </p>
            ) : (
              <>
                <p>Showing {data.data.length} customers on this page.</p>
                <table className={styles.table}>
                  <caption className={styles.srOnly}>Customer directory</caption>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Code</th>
                      <th scope="col">Email</th>
                      <th scope="col">Status</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((customer) => (
                      <tr key={customer.id}>
                        <th scope="row">
                          <Link to={`${base}/${customer.id}`}>{customer.displayName}</Link>
                        </th>
                        <td data-label="Code">{customer.customerCode ?? 'Not set'}</td>
                        <td data-label="Email">{customer.email ?? 'Not set'}</td>
                        <td data-label="Status">
                          <span
                            className={
                              customer.status === 'ACTIVE' ? styles.active : styles.archived
                            }
                          >
                            {customer.status}
                          </span>
                        </td>
                        <td data-label="Actions">
                          <div className={styles.actions}>
                            <Link
                              to={`${base}/${customer.id}`}
                              aria-label={`View ${customer.displayName}`}
                            >
                              View
                            </Link>
                            {context.hasPermission('customer.update') && (
                              <Link
                                to={`${base}/${customer.id}/edit`}
                                aria-label={`Edit ${customer.displayName}`}
                              >
                                Edit
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            <nav className={styles.pagination} aria-label="Customer pagination">
              <button
                className={styles.secondary}
                disabled={cursors.length === 1}
                onClick={() => setCursors((previous) => previous.slice(0, -1))}
              >
                Previous page
              </button>
              <span>Page {cursors.length}</span>
              <button
                className={styles.secondary}
                disabled={!data.meta.hasMore}
                onClick={() => {
                  if (data.meta.nextCursor)
                    setCursors((previous) => [...previous, data.meta.nextCursor!]);
                }}
              >
                Next page
              </button>
            </nav>
          </section>
        )
      )}
    </div>
  );
}
export function CustomerCreatePage() {
  const context = useOrganization();
  return (
    <CustomerBoundary permission="customer.create">
      {context.organization && (
        <CustomerForm key={context.organization.id} organizationId={context.organization.id} />
      )}
    </CustomerBoundary>
  );
}
export function CustomerDetailsPage() {
  return <CustomerRecordRoute edit={false} />;
}
export function CustomerEditPage() {
  return <CustomerRecordRoute edit />;
}
function CustomerRecordRoute({ edit }: { edit: boolean }) {
  const context = useOrganization();
  const { customerId } = useParams();
  return (
    <CustomerBoundary permission={edit ? 'customer.update' : 'customer.read'}>
      {context.organization &&
        (customerId && organizationIdPattern.test(customerId) ? (
          <CustomerRecord
            key={`${context.organization.id}:${customerId}`}
            organizationId={context.organization.id}
            customerId={customerId}
            edit={edit}
          />
        ) : (
          <p role="alert">Customer not found.</p>
        ))}
    </CustomerBoundary>
  );
}
function CustomerRecord({
  organizationId,
  customerId,
  edit,
}: {
  organizationId: string;
  customerId: string;
  edit: boolean;
}) {
  const context = useOrganization();
  const { user } = useAuth();
  const detail = useCustomerDetail(organizationId, customerId);
  const [archiveOpen, setArchiveOpen] = useState(false);
  if (detail.isPending || detail.isFetching)
    return (
      <p role="status" className={styles.panel}>
        Loading customer…
      </p>
    );
  if (detail.isError)
    return (
      <CustomerError
        error={detail.error}
        retry={() => {
          void detail.refetch();
        }}
      />
    );
  const resource = detail.data;
  const customer = resource.customer;
  if (edit)
    return (
      <CustomerForm
        key={`${user!.id}:${customer.id}:${resource.etag}`}
        organizationId={organizationId}
        resource={resource}
        reload={() => {
          void detail.refetch();
        }}
      />
    );
  const base = `/organizations/${organizationId}/customers`;
  const timestamp = (value: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: context.organization!.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  return (
    <section className={styles.panel}>
      <Link to={base}>Back to customers</Link>
      <h1>{customer.displayName}</h1>
      <p>
        <span className={customer.status === 'ACTIVE' ? styles.active : styles.archived}>
          {customer.status}
        </span>
      </p>
      {customer.status === 'ARCHIVED' && (
        <p>This customer is archived. The record remains readable; restoration is unavailable.</p>
      )}
      <dl className={styles.details}>
        <div>
          <dt>Customer code</dt>
          <dd>{customer.customerCode ?? 'Not set'}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{customer.email ?? 'Not set'}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            <time dateTime={customer.createdAt}>{timestamp(customer.createdAt)}</time>
          </dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>
            <time dateTime={customer.updatedAt}>{timestamp(customer.updatedAt)}</time>
          </dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{customer.version}</dd>
        </div>
      </dl>
      <div className={styles.actions}>
        {context.hasPermission('customer.update') && (
          <Link className={styles.primary} to={`${base}/${customer.id}/edit`}>
            Edit customer
          </Link>
        )}
        {context.hasPermission('customer.archive') && customer.status === 'ACTIVE' && (
          <button className={styles.secondary} onClick={() => setArchiveOpen(true)}>
            Archive customer
          </button>
        )}
      </div>
      {archiveOpen && <ArchiveDialog customer={customer} close={() => setArchiveOpen(false)} />}
    </section>
  );
}
