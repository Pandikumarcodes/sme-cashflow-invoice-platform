import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/errors';
import { useOrganization } from '../../organizations/OrganizationContext';
import { OrganizationWorkspace, PermissionBoundary } from '../../organizations/Workspace';
import { organizationIdPattern } from '../../organizations/contracts';
import { dateSchema, defaultFilters, type InvoiceFilters, type InvoiceResource } from './contracts';
import { useInvoiceDetail, useInvoiceList } from './queries';
import { formatInvoiceMoney, InvoiceDecimal } from './calculation';
import { InvoiceForm } from './InvoiceForm';
import { CustomerPicker } from './CustomerPicker';
import { InvoiceActionDialog } from './InvoiceActionDialog';
import type { InvoiceAction } from './api';
import styles from './Invoices.module.css';
function Boundary({ permission, children }: { permission: string; children: ReactNode }) {
  const context = useOrganization();
  if (context.status !== 'ready') return <OrganizationWorkspace />;
  return <PermissionBoundary permission={permission}>{children}</PermissionBoundary>;
}
function InvoiceError({ error, retry }: { error: unknown; retry: () => void }) {
  const api = error instanceof ApiError ? error : undefined;
  return (
    <section className={styles.panel}>
      <h2>
        {api?.status === 404
          ? 'Invoice not found'
          : api?.status === 403
            ? 'Access denied'
            : 'Invoices unavailable'}
      </h2>
      <p role="alert">{api?.message ?? 'The invoice request could not be completed.'}</p>
      <button type="button" onClick={retry}>
        Retry invoice request
      </button>
    </section>
  );
}
export function InvoiceListPage() {
  const context = useOrganization();
  return (
    <Boundary permission="invoice.read">
      {context.organization && <InvoiceList key={context.organization.id} />}
    </Boundary>
  );
}
const selectors = [
  ['status', 'Invoice status', ['', 'DRAFT', 'ISSUED', 'CANCELLED', 'VOID']],
  ['paymentState', 'Payment state', ['', 'NOT_APPLICABLE', 'UNPAID', 'PARTIALLY_PAID', 'PAID']],
  ['overdue', 'Overdue', ['', 'true', 'false']],
  ['sortBy', 'Sort invoices by', ['issueDate', 'dueDate', 'createdAt', 'total', 'invoiceNumber']],
  ['sortOrder', 'Invoice sort order', ['desc', 'asc']],
] as const;
function validDates(filters: InvoiceFilters) {
  for (const prefix of ['issueDate', 'dueDate'] as const) {
    const from = filters[`${prefix}From`];
    const to = filters[`${prefix}To`];
    if (
      (from && !dateSchema.safeParse(from).success) ||
      (to && !dateSchema.safeParse(to).success) ||
      (from && to && (to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 1825))
    )
      return false;
  }
  return !filters.customerId || organizationIdPattern.test(filters.customerId);
}
function InvoiceList() {
  const organization = useOrganization().organization!;
  const context = useOrganization();
  const [filters, setFilters] = useState({ ...defaultFilters });
  const [input, setInput] = useState('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const validSearch =
    input === '' || (input.length >= 2 && input.length <= 100 && /\S/.test(input));
  useEffect(() => {
    if (input === filters.search || !validSearch) return;
    const timer = window.setTimeout(() => {
      setFilters((previous) => ({ ...previous, search: input }));
      setCursors([undefined]);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [input, filters.search, validSearch]);
  const valid = validSearch && validDates(filters);
  const settling = input !== filters.search;
  const list = useInvoiceList(
    organization.id,
    organization.baseCurrency,
    filters,
    cursors.at(-1),
    valid && !settling,
  );
  const data = valid && !settling && !list.isFetching && !list.isError ? list.data : undefined;
  const change = (values: Partial<InvoiceFilters>) => {
    setFilters((previous) => ({ ...previous, ...values }));
    setCursors([undefined]);
  };
  const base = `/organizations/${organization.id}/invoices`;
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h1>Invoices</h1>
          <p>
            Review drafts and issued documents for{' '}
            {organization.displayName ?? organization.legalName}.
          </p>
        </div>
        {context.hasPermission('invoice.create') && (
          <Link to={`${base}/new`} className={styles.primary}>
            Create invoice
          </Link>
        )}
      </header>
      <section className={styles.panel} aria-label="Invoice filters">
        <div className={styles.grid}>
          <div className={styles.field}>
            <label htmlFor="invoice-search">Search invoices</label>
            <input
              id="invoice-search"
              type="search"
              value={input}
              maxLength={100}
              onChange={(event) => setInput(event.target.value)}
              aria-invalid={!validSearch}
            />
            <small>2–100 characters; invoice number or customer name.</small>
          </div>
          {selectors.map(([field, label, options]) => (
            <div className={styles.field} key={field}>
              <label htmlFor={`filter-${field}`}>{label}</label>
              <select
                id={`filter-${field}`}
                value={filters[field]}
                onChange={(event) => change({ [field]: event.target.value })}
              >
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option === ''
                      ? 'All'
                      : option === 'true'
                        ? 'Overdue only'
                        : option === 'false'
                          ? 'Not overdue'
                          : option}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className={styles.field}>
            <label htmlFor="invoice-page-size">Invoice page size</label>
            <select
              id="invoice-page-size"
              value={filters.limit}
              onChange={(event) => change({ limit: Number(event.target.value) })}
            >
              {[25, 50, 100].map((limit) => (
                <option key={limit}>{limit}</option>
              ))}
            </select>
          </div>
          <CustomerPicker
            organizationId={organization.id}
            value={filters.customerId}
            onChange={(customerId) => change({ customerId })}
            disabled={false}
            invalid={false}
            optional
          />
          {(['issueDateFrom', 'issueDateTo', 'dueDateFrom', 'dueDateTo'] as const).map((field) => (
            <div key={field} className={styles.field}>
              <label htmlFor={`filter-${field}`}>
                {
                  {
                    issueDateFrom: 'Invoice date from',
                    issueDateTo: 'Invoice date to',
                    dueDateFrom: 'Due date from',
                    dueDateTo: 'Due date to',
                  }[field]
                }
              </label>
              <input
                id={`filter-${field}`}
                type="date"
                value={filters[field]}
                onChange={(event) => change({ [field]: event.target.value })}
              />
            </div>
          ))}
        </div>
      </section>
      {!valid ? (
        <p role="status">
          Check search length, customer UUID and valid ordered date ranges (at most 1,825 days).
        </p>
      ) : settling || list.isPending || list.isFetching ? (
        <p role="status" className={styles.panel}>
          Loading invoices…
        </p>
      ) : list.isError ? (
        <>
          <InvoiceError
            error={list.error}
            retry={() => {
              void list.refetch();
            }}
          />
          {list.error instanceof ApiError && list.error.code === 'INVALID_CURSOR' && (
            <button type="button" onClick={() => setCursors([undefined])}>
              Restart invoice pagination
            </button>
          )}
        </>
      ) : (
        data && (
          <section className={styles.panel} aria-label="Invoice results">
            {!data.data.length ? (
              <p role="status">
                {filters.search
                  ? 'No invoices match this search.'
                  : cursors.length > 1
                    ? 'No invoices on this page. Return to the previous page.'
                    : 'No invoices match these filters.'}
              </p>
            ) : (
              <>
                <p>Showing {data.data.length} invoices on this page.</p>
                <table className={styles.table}>
                  <caption className={styles.srOnly}>Invoice directory</caption>
                  <thead>
                    <tr>
                      {['Invoice', 'Customer', 'Dates', 'Status', 'Total', 'Actions'].map(
                        (label) => (
                          <th key={label} scope="col">
                            {label}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((invoice) => (
                      <tr key={invoice.id}>
                        <th scope="row">
                          <Link to={`${base}/${invoice.id}`}>
                            {invoice.invoiceNumber ?? 'Unnumbered draft'}
                          </Link>
                        </th>
                        <td data-label="Customer">{invoice.customer.displayName}</td>
                        <td data-label="Dates">
                          <span>Invoice: {invoice.issueDate}</span>
                          <br />
                          <span>Due: {invoice.dueDate}</span>
                        </td>
                        <td data-label="Status">
                          <span
                            className={
                              invoice.status === 'ISSUED'
                                ? styles.success
                                : invoice.status === 'DRAFT'
                                  ? styles.warning
                                  : styles.error
                            }
                          >
                            {invoice.status}
                          </span>
                          <br />
                          {invoice.paymentState}
                          {invoice.isOverdue && (
                            <strong className={styles.error}> · Overdue</strong>
                          )}
                        </td>
                        <td data-label="Total">
                          {formatInvoiceMoney(invoice.total, invoice.currency)}{' '}
                          <small>{invoice.currency}</small>
                        </td>
                        <td data-label="Actions">
                          <div className={styles.actions}>
                            <Link
                              to={`${base}/${invoice.id}`}
                              aria-label={`View invoice ${invoice.invoiceNumber ?? invoice.id}`}
                            >
                              View
                            </Link>
                            {invoice.status === 'DRAFT' &&
                              context.hasPermission('invoice.update_draft') && (
                                <Link
                                  to={`${base}/${invoice.id}/edit`}
                                  aria-label={`Edit draft ${invoice.id}`}
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
            <nav aria-label="Invoice pagination" className={styles.pagination}>
              <button
                disabled={cursors.length === 1}
                onClick={() => setCursors((previous) => previous.slice(0, -1))}
              >
                Previous invoices
              </button>
              <span>Invoice page {cursors.length}</span>
              <button
                disabled={!data.meta.hasMore}
                onClick={() => {
                  if (data.meta.nextCursor)
                    setCursors((previous) => [...previous, data.meta.nextCursor!]);
                }}
              >
                Next invoices
              </button>
            </nav>
          </section>
        )
      )}
    </div>
  );
}
export function InvoiceCreatePage() {
  const context = useOrganization();
  return (
    <Boundary permission="invoice.create">
      {context.organization && <InvoiceForm key={context.organization.id} />}
    </Boundary>
  );
}
export function InvoiceDetailsPage() {
  return <RecordRoute edit={false} />;
}
export function InvoiceEditPage() {
  return <RecordRoute edit />;
}
function RecordRoute({ edit }: { edit: boolean }) {
  const context = useOrganization();
  const { invoiceId } = useParams();
  return (
    <Boundary permission={edit ? 'invoice.update_draft' : 'invoice.read'}>
      {context.organization &&
        (invoiceId && organizationIdPattern.test(invoiceId) ? (
          <InvoiceRecord
            key={`${context.organization.id}:${invoiceId}`}
            id={invoiceId}
            edit={edit}
          />
        ) : (
          <p role="alert">Invoice not found.</p>
        ))}
    </Boundary>
  );
}
function InvoiceRecord({ id, edit }: { id: string; edit: boolean }) {
  const context = useOrganization();
  const organization = context.organization!;
  const { user } = useAuth();
  const detail = useInvoiceDetail(organization.id, organization.baseCurrency, id);
  if (detail.isPending || detail.isFetching)
    return (
      <p role="status" className={styles.panel}>
        Loading invoice…
      </p>
    );
  if (detail.isError)
    return (
      <InvoiceError
        error={detail.error}
        retry={() => {
          void detail.refetch();
        }}
      />
    );
  const resource = detail.data;
  if (edit)
    return resource.invoice.status === 'DRAFT' ? (
      <InvoiceForm
        key={`${user!.id}:${resource.invoice.id}:${resource.etag}`}
        resource={resource}
        reload={() => {
          void detail.refetch();
        }}
      />
    ) : (
      <section className={styles.panel}>
        <h1>Invoice is finalized</h1>
        <p>This document cannot be edited.</p>
        <Link to={`/organizations/${organization.id}/invoices/${id}`}>View invoice</Link>
      </section>
    );
  return (
    <InvoiceDetails
      resource={resource}
      reload={() => {
        void detail.refetch();
      }}
    />
  );
}
function InvoiceDetails({ resource, reload }: { resource: InvoiceResource; reload: () => void }) {
  const context = useOrganization();
  const invoice = resource.invoice;
  const [action, setAction] = useState<InvoiceAction>();
  const base = `/organizations/${invoice.organizationId}/invoices`;
  const money = (value: string) =>
    `${formatInvoiceMoney(value, invoice.currency)} ${invoice.currency}`;
  const timestamp = (value: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: context.organization!.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  return (
    <section className={styles.panel}>
      <Link to={base}>Back to invoices</Link>
      <h1>{invoice.invoiceNumber ?? 'Unnumbered draft'}</h1>
      <p
        className={
          invoice.status === 'DRAFT'
            ? styles.warning
            : invoice.status === 'ISSUED'
              ? styles.success
              : styles.error
        }
      >
        {invoice.status} · {invoice.paymentState}
        {invoice.isOverdue && ' · Overdue'}
      </p>
      <p>
        {invoice.status === 'DRAFT'
          ? 'Draft amounts are server-calculated. The official number is assigned at issuance.'
          : 'Issued customer snapshot, dates, currency, line items and totals are immutable.'}
      </p>
      <dl className={styles.details}>
        <div>
          <dt>Customer</dt>
          <dd>{invoice.customer.displayName}</dd>
        </div>
        <div>
          <dt>Customer email</dt>
          <dd>{invoice.customer.email ?? 'Not set'}</dd>
        </div>
        <div>
          <dt>Invoice date</dt>
          <dd>{invoice.issueDate}</dd>
        </div>
        <div>
          <dt>Due date</dt>
          <dd>{invoice.dueDate}</dd>
        </div>
        <div>
          <dt>Currency</dt>
          <dd>{invoice.currency}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{invoice.version}</dd>
        </div>
        <div>
          <dt>Discount</dt>
          <dd>
            {invoice.discount.type}: {invoice.discount.value}
          </dd>
        </div>
        <div>
          <dt>Tax rate</dt>
          <dd>{invoice.taxRate}%</dd>
        </div>
      </dl>
      <table className={styles.table}>
        <caption>Invoice items</caption>
        <thead>
          <tr>
            {['Description', 'Quantity', 'Unit price', 'Line amount'].map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id}>
              <th scope="row">{item.description}</th>
              <td data-label="Quantity">{item.quantity}</td>
              <td data-label="Unit price">
                {item.unitPrice} {invoice.currency}
              </td>
              <td data-label="Line amount">{money(item.lineAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className={styles.details}>
        {(
          [
            'subtotal',
            'discountTotal',
            'taxableTotal',
            'taxTotal',
            'total',
            'amountPaid',
            'balanceDue',
          ] as const
        ).map((field) => (
          <div key={field}>
            <dt>
              {
                {
                  subtotal: 'Subtotal',
                  discountTotal: 'Discount total',
                  taxableTotal: 'Taxable total',
                  taxTotal: 'Tax total',
                  total: 'Total',
                  amountPaid: 'Amount paid',
                  balanceDue: 'Balance due',
                }[field]
              }
            </dt>
            <dd>{money(invoice[field])}</dd>
          </div>
        ))}
      </dl>
      {invoice.status !== 'ISSUED' && (
        <p>
          Balance due is an arithmetic residual; this {invoice.status.toLowerCase()} is not a
          collectible issued receivable.
        </p>
      )}
      <dl className={styles.details}>
        {(
          [
            ['Created', invoice.createdAt],
            ['Updated', invoice.updatedAt],
            ['Issued', invoice.issuedAt],
            ['Cancelled', invoice.cancelledAt],
            ['Voided', invoice.voidedAt],
          ] as const
        ).map(
          ([label, value]) =>
            value && (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <time dateTime={value}>{timestamp(value)}</time>
                </dd>
              </div>
            ),
        )}
        {invoice.cancelReason && (
          <div>
            <dt>Cancellation reason</dt>
            <dd>{invoice.cancelReason}</dd>
          </div>
        )}
        {invoice.voidReason && (
          <div>
            <dt>Void reason</dt>
            <dd>{invoice.voidReason}</dd>
          </div>
        )}
      </dl>
      <div className={styles.actions}>
        {context.hasPermission('payment.read') && (
          <Link to={`/organizations/${invoice.organizationId}/payments?invoiceId=${invoice.id}`}>
            View invoice payments
          </Link>
        )}
        {invoice.status === 'ISSUED' &&
          new InvoiceDecimal(invoice.balanceDue).gt('0') &&
          context.hasPermission('payment.create') && (
            <Link
              className={styles.primary}
              to={`/organizations/${invoice.organizationId}/payments/new?invoiceId=${invoice.id}`}
            >
              Record payment
            </Link>
          )}
        {invoice.status === 'DRAFT' && context.hasPermission('invoice.update_draft') && (
          <Link to={`${base}/${invoice.id}/edit`} className={styles.primary}>
            Edit draft
          </Link>
        )}
        {(['issue', 'delete', 'cancel', 'void'] as const).map(
          (operation) =>
            (operation === 'issue' || operation === 'delete'
              ? invoice.status === 'DRAFT'
              : invoice.status === 'ISSUED') &&
            context.hasPermission(
              operation === 'delete' ? 'invoice.delete_draft' : `invoice.${operation}`,
            ) && (
              <button
                key={operation}
                type="button"
                disabled={
                  operation === 'issue'
                    ? new InvoiceDecimal(invoice.total).isZero()
                    : (operation === 'cancel' || operation === 'void') &&
                      new InvoiceDecimal(invoice.amountPaid).gt('0')
                }
                onClick={() => setAction(operation)}
              >
                {
                  {
                    issue: 'Issue invoice',
                    delete: 'Delete draft',
                    cancel: 'Cancel issued invoice',
                    void: 'Void invoice',
                  }[operation]
                }
              </button>
            ),
        )}
      </div>
      {action && (
        <InvoiceActionDialog
          action={action}
          resource={resource}
          close={() => setAction(undefined)}
          reload={reload}
        />
      )}
    </section>
  );
}
