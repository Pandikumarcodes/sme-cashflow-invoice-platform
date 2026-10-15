import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/errors';
import { useOrganization } from '../../organizations/OrganizationContext';
import { OrganizationWorkspace, PermissionBoundary } from '../../organizations/Workspace';
import { organizationIdPattern } from '../../organizations/contracts';
import { formatInvoiceMoney } from '../invoices/calculation';
import {
  defaultFilters,
  methods,
  validFilters,
  type PaymentFilters,
  type Payment,
} from './contracts';
import { usePaymentList, usePaymentDetail } from './queries';
import { EligibleInvoices, SelectedPaymentInvoice } from './PaymentRecordForm';
import { ReversalDialog } from './ReversalDialog';
import { OperationsFilterToolbar } from '../../components/filters/OperationsFilterToolbar';
import styles from './Payments.module.css';
function Boundary({ permission, children }: { permission: string; children: ReactNode }) {
  const context = useOrganization();
  if (context.status !== 'ready') return <OrganizationWorkspace />;
  return <PermissionBoundary permission={permission}>{children}</PermissionBoundary>;
}
function PaymentError({ error, retry }: { error: unknown; retry: () => void }) {
  const api = error instanceof ApiError ? error : undefined;
  return (
    <section className={styles.panel}>
      <h2>
        {api?.status === 404
          ? 'Payment not found'
          : api?.status === 403
            ? 'Access denied'
            : 'Payments unavailable'}
      </h2>
      <p role="alert">{api?.message ?? 'The payment request could not be completed.'}</p>
      <button onClick={retry}>Retry payment request</button>
    </section>
  );
}
export function PaymentListPage() {
  const context = useOrganization();
  const [params] = useSearchParams();
  return (
    <Boundary permission="payment.read">
      {context.organization && (
        <PaymentList
          key={`${context.organization.id}:${params.get('invoiceId') ?? ''}`}
          initialInvoice={params.get('invoiceId') ?? ''}
        />
      )}
    </Boundary>
  );
}
function PaymentList({ initialInvoice }: { initialInvoice: string }) {
  const context = useOrganization();
  const org = context.organization!;
  const [filters, setFilters] = useState({ ...defaultFilters, invoiceId: initialInvoice });
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const valid = validFilters(filters);
  const list = usePaymentList(org.id, org.baseCurrency, filters, cursors.at(-1), valid);
  const change = (values: Partial<PaymentFilters>) => {
    setFilters((old) => ({ ...old, ...values }));
    setCursors([undefined]);
  };
  const base = `/organizations/${org.id}/payments`;
  const advancedActive = [
    filters.invoiceId,
    filters.paymentDateFrom,
    filters.paymentDateTo,
    filters.sortBy !== defaultFilters.sortBy,
    filters.sortOrder !== defaultFilters.sortOrder,
    filters.limit !== defaultFilters.limit,
  ].filter(Boolean).length;
  const clearFilters = () => {
    setFilters({ ...defaultFilters });
    setCursors([undefined]);
  };
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h1>Payments</h1>
          <p>Track recorded payments and reversals.</p>
        </div>
        {context.hasPermission('payment.create') && (
          <Link className={styles.primary} to={`${base}/new`}>
            Record payment
          </Link>
        )}
      </header>
      <OperationsFilterToolbar
        ariaLabel="Payment filters"
        activeAdvancedCount={advancedActive}
        onClear={clearFilters}
        primary={
          <>
            {(
              [
                ['status', 'Payment status', ['', 'RECORDED', 'REVERSED']],
                ['method', 'Payment method', ['', ...methods]],
              ] as const
            ).map(([field, label, options]) => (
              <div className={styles.field} key={field}>
                <label htmlFor={`payment-filter-${field}`}>{label}</label>
                <select
                  id={`payment-filter-${field}`}
                  value={filters[field]}
                  onChange={(event) => change({ [field]: event.target.value })}
                >
                  {options.map((value) => (
                    <option key={value} value={value}>
                      {value || 'All'}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </>
        }
        advanced={
          <>
            <div className={styles.field}>
              <label htmlFor="filter-invoice">Invoice ID filter</label>
              <input
                id="filter-invoice"
                value={filters.invoiceId}
                onChange={(event) => change({ invoiceId: event.target.value })}
              />
              <small>Optional invoice UUID; invoice details link here automatically.</small>
            </div>
            {(
              [
                ['sortBy', 'Sort payments by', ['paymentDate', 'recordedAt', 'amount']],
                ['sortOrder', 'Payment sort order', ['desc', 'asc']],
              ] as const
            ).map(([field, label, options]) => (
              <div className={styles.field} key={field}>
                <label htmlFor={`payment-filter-${field}`}>{label}</label>
                <select
                  id={`payment-filter-${field}`}
                  value={filters[field]}
                  onChange={(event) => change({ [field]: event.target.value })}
                >
                  {options.map((value) => (
                    <option key={value} value={value}>
                      {value === 'paymentDate'
                        ? 'Payment date'
                        : value === 'recordedAt'
                          ? 'Recorded date'
                          : value === 'amount'
                            ? 'Amount'
                            : value === 'desc'
                              ? 'Descending'
                              : value === 'asc'
                                ? 'Ascending'
                                : 'All'}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {(['paymentDateFrom', 'paymentDateTo'] as const).map((field) => (
              <div className={styles.field} key={field}>
                <label htmlFor={`filter-${field}`}>
                  Payment date {field.endsWith('From') ? 'from' : 'to'}
                </label>
                <input
                  id={`filter-${field}`}
                  type="date"
                  value={filters[field]}
                  onChange={(event) => change({ [field]: event.target.value })}
                />
              </div>
            ))}
            <div className={styles.field}>
              <label htmlFor="payment-page-size">Payment page size</label>
              <select
                id="payment-page-size"
                value={filters.limit}
                onChange={(event) => change({ limit: Number(event.target.value) })}
              >
                {[25, 50, 100].map((limit) => (
                  <option key={limit}>{limit}</option>
                ))}
              </select>
            </div>
          </>
        }
      />
      {!valid ? (
        <p role="alert">
          Check invoice UUID and valid ordered payment dates (at most 1,825 days apart).
        </p>
      ) : list.isPending || list.isFetching ? (
        <p role="status">Loading payments…</p>
      ) : list.isError ? (
        <>
          <PaymentError
            error={list.error}
            retry={() => {
              void list.refetch();
            }}
          />
          {list.error instanceof ApiError && list.error.code === 'INVALID_CURSOR' && (
            <button onClick={() => setCursors([undefined])}>Restart payment pagination</button>
          )}
        </>
      ) : (
        <section className={styles.panel}>
          {!list.data.data.length ? (
            <p role="status">No payments match these filters.</p>
          ) : (
            <>
              <p>Showing {list.data.data.length} payments on this page.</p>
              <table className={styles.table}>
                <caption>Payment history</caption>
                <thead>
                  <tr>
                    {['Payment', 'Invoice', 'Amount', 'Date', 'Method', 'Status'].map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map((p) => (
                    <tr key={p.id}>
                      <th scope="row">
                        <Link to={`${base}/${p.id}`}>{p.id}</Link>
                      </th>
                      <td data-label="Invoice">
                        <Link to={`/organizations/${org.id}/invoices/${p.invoiceId}`}>
                          {p.invoice.invoiceNumber ?? p.invoiceId}
                        </Link>
                      </td>
                      <td data-label="Amount">
                        {formatInvoiceMoney(p.amount, p.currency)} {p.currency}
                      </td>
                      <td data-label="Date">{p.paymentDate}</td>
                      <td data-label="Method">{p.method}</td>
                      <td
                        data-label="Status"
                        className={p.status === 'RECORDED' ? styles.success : styles.warning}
                      >
                        {p.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <nav className={styles.pagination} aria-label="Payment pagination">
            <button
              disabled={cursors.length === 1}
              onClick={() => setCursors((old) => old.slice(0, -1))}
            >
              Previous payments
            </button>
            <span>Payment page {cursors.length}</span>
            <button
              disabled={!list.data.meta.hasMore}
              onClick={() => {
                if (list.data.meta.nextCursor)
                  setCursors((old) => [...old, list.data.meta.nextCursor!]);
              }}
            >
              Next payments
            </button>
          </nav>
        </section>
      )}
    </div>
  );
}
export function PaymentCreatePage() {
  const context = useOrganization();
  const [params] = useSearchParams();
  return (
    <Boundary permission="payment.create">
      {context.organization && (
        <PaymentCreate
          key={`${context.organization.id}:${params.get('invoiceId') ?? ''}`}
          initialInvoice={params.get('invoiceId') ?? ''}
        />
      )}
    </Boundary>
  );
}
function PaymentCreate({ initialInvoice }: { initialInvoice: string }) {
  const [selected, setSelected] = useState(initialInvoice);
  return (
    <div className={styles.page}>
      <h1>Record payment</h1>
      {selected ? (
        organizationIdPattern.test(selected) ? (
          <SelectedPaymentInvoice
            key={selected}
            id={selected}
            chooseAgain={() => setSelected('')}
          />
        ) : (
          <p role="alert">Invoice not found.</p>
        )
      ) : (
        <EligibleInvoices choose={setSelected} />
      )}
    </div>
  );
}
export function PaymentDetailsPage() {
  const context = useOrganization();
  const { paymentId } = useParams();
  return (
    <Boundary permission="payment.read">
      {context.organization &&
        (paymentId && organizationIdPattern.test(paymentId) ? (
          <PaymentRecord key={`${context.organization.id}:${paymentId}`} id={paymentId} />
        ) : (
          <p role="alert">Payment not found.</p>
        ))}
    </Boundary>
  );
}
function PaymentRecord({ id }: { id: string }) {
  const org = useOrganization().organization!;
  const detail = usePaymentDetail(org.id, org.baseCurrency, id);
  if (detail.isPending || detail.isFetching) return <p role="status">Loading payment…</p>;
  if (detail.isError)
    return (
      <PaymentError
        error={detail.error}
        retry={() => {
          void detail.refetch();
        }}
      />
    );
  return (
    <PaymentDetails
      payment={detail.data}
      reload={() => {
        void detail.refetch();
      }}
    />
  );
}
function PaymentDetails({ payment: p, reload }: { payment: Payment; reload: () => void }) {
  const context = useOrganization();
  const org = context.organization!;
  const [reversing, setReversing] = useState(false);
  const money = (value: string) => `${formatInvoiceMoney(value, p.currency)} ${p.currency}`;
  const time = (value: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: org.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  return (
    <section className={styles.panel}>
      <Link to={`/organizations/${org.id}/payments`}>Back to payments</Link>
      <h1>Payment details</h1>
      <p className={p.status === 'RECORDED' ? styles.success : styles.warning}>{p.status}</p>
      <dl className={styles.details}>
        {[
          ['Payment ID', p.id],
          ['Amount', money(p.amount)],
          ['Payment date', p.paymentDate],
          ['Method', p.method],
          ['Recorded by', p.createdByUserId],
          ['Recorded at', time(p.recordedAt)],
          ['Updated at', time(p.updatedAt)],
          ['Invoice status', p.invoice.status],
          ['Settlement state', p.invoice.paymentState],
          ['Current amount paid', money(p.invoice.amountPaid)],
          ['Current balance due', money(p.invoice.balanceDue)],
          ['Invoice version', String(p.invoice.version)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <Link to={`/organizations/${org.id}/invoices/${p.invoiceId}`}>
        View invoice {p.invoice.invoiceNumber ?? p.invoiceId}
      </Link>
      {p.reversal && (
        <section aria-label="Full reversal details">
          <h2>Full reversal</h2>
          <dl className={styles.details}>
            {[
              ['Reversal ID', p.reversal.id],
              ['Full amount', money(p.reversal.amount)],
              ['Reason', p.reversal.reason],
              ['Reversal date', p.reversal.reversalDate],
              ['Reversed by', p.reversal.reversedByUserId],
              ['Reversed at', time(p.reversedAt!)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {p.status === 'RECORDED' &&
        p.invoice.status === 'ISSUED' &&
        context.hasPermission('payment.reverse') && (
          <button className={styles.danger} onClick={() => setReversing(true)}>
            Reverse payment in full
          </button>
        )}
      {reversing && (
        <ReversalDialog payment={p} close={() => setReversing(false)} reload={reload} />
      )}
    </section>
  );
}
