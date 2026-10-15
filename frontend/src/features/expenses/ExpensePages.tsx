import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useOrganization } from '../../organizations/OrganizationContext';
import { organizationIdPattern } from '../../organizations/contracts';
import { ApiError } from '../../api/errors';
import { formatInvoiceMoney } from '../invoices/calculation';
import {
  defaultFilters,
  validFilters,
  type ExpenseFilters,
  type ExpenseResource,
} from './contracts';
import { useExpenseList, useExpenseDetail } from './queries';
import { CategoryPicker } from './CategoryPicker';
import { ExpenseForm } from './ExpenseForm';
import { LifecycleDialog } from './LifecycleDialog';
import { ExpenseBoundary, ExpenseError } from './states';
import { OperationsFilterToolbar } from '../../components/filters/OperationsFilterToolbar';
import styles from './Expenses.module.css';
export function ExpenseListPage() {
  const context = useOrganization();
  return (
    <ExpenseBoundary permission="expense.read">
      {context.organization && <ExpenseList key={context.organization.id} />}
    </ExpenseBoundary>
  );
}
function ExpenseList() {
  const context = useOrganization();
  const org = context.organization!;
  const [filters, setFilters] = useState({ ...defaultFilters });
  const [vendor, setVendor] = useState('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const vendorValid = vendor === '' || (vendor.length <= 200 && !!vendor.trim());
  useEffect(() => {
    if (!vendorValid || vendor === filters.vendor) return;
    const timer = window.setTimeout(() => {
      setFilters((old) => ({ ...old, vendor }));
      setCursors([undefined]);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [vendor, vendorValid, filters.vendor]);
  const valid = vendorValid && validFilters(filters);
  const settling = vendor !== filters.vendor;
  const list = useExpenseList(
    org.id,
    org.baseCurrency,
    filters,
    cursors.at(-1),
    valid && !settling,
  );
  const change = (values: Partial<ExpenseFilters>) => {
    setFilters((old) => ({ ...old, ...values }));
    setCursors([undefined]);
  };
  const base = `/organizations/${org.id}/expenses`;
  const advancedActive = [
    filters.expenseDateFrom,
    filters.expenseDateTo,
    filters.sortBy !== defaultFilters.sortBy,
    filters.sortOrder !== defaultFilters.sortOrder,
    filters.limit !== defaultFilters.limit,
  ].filter(Boolean).length;
  const clearFilters = () => {
    setVendor('');
    setFilters({ ...defaultFilters });
    setCursors([undefined]);
  };
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h1>Expenses</h1>
          <p>Track business spending and expense records.</p>
        </div>
        <div className={styles.actions}>
          <Link to={`/organizations/${org.id}/expense-categories`}>Expense categories</Link>
          {context.hasPermission('expense.create') && (
            <Link className={styles.primary} to={`${base}/new`}>
              Record expense
            </Link>
          )}
        </div>
      </header>
      <OperationsFilterToolbar
        ariaLabel="Expense filters"
        activeAdvancedCount={advancedActive}
        onClear={clearFilters}
        primary={
          <>
            <div className={styles.field}>
              <label htmlFor="expense-vendor-search">Search vendor / payee</label>
              <input
                id="expense-vendor-search"
                type="search"
                value={vendor}
                maxLength={200}
                onChange={(event) => setVendor(event.target.value)}
              />
              <small>Literal case-insensitive vendor matching; no description search.</small>
            </div>
            {([['status', 'Expense status', ['ACTIVE', 'VOIDED']]] as const).map(
              ([field, label, options]) => (
                <div key={field} className={styles.field}>
                  <label htmlFor={`expense-filter-${field}`}>{label}</label>
                  <select
                    id={`expense-filter-${field}`}
                    value={filters[field]}
                    onChange={(event) => change({ [field]: event.target.value })}
                  >
                    {options.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </div>
              ),
            )}
          </>
        }
        advanced={
          <>
            {(
              [
                [
                  'sortBy',
                  'Sort expenses by',
                  ['expenseDate', 'createdAt', 'amount', 'vendorPayee'],
                ],
                ['sortOrder', 'Expense sort order', ['desc', 'asc']],
              ] as const
            ).map(([field, label, options]) => (
              <div key={field} className={styles.field}>
                <label htmlFor={`expense-filter-${field}`}>{label}</label>
                <select
                  id={`expense-filter-${field}`}
                  value={filters[field]}
                  onChange={(event) => change({ [field]: event.target.value })}
                >
                  {options.map((value) => (
                    <option key={value} value={value}>
                      {value === 'expenseDate'
                        ? 'Expense date'
                        : value === 'createdAt'
                          ? 'Created date'
                          : value === 'vendorPayee'
                            ? 'Vendor / payee'
                            : value === 'amount'
                              ? 'Amount'
                              : value === 'desc'
                                ? 'Descending'
                                : 'Ascending'}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {(['expenseDateFrom', 'expenseDateTo'] as const).map((field) => (
              <div key={field} className={styles.field}>
                <label htmlFor={`filter-${field}`}>
                  Expense date {field.endsWith('From') ? 'from' : 'to'}
                </label>
                <input
                  type="date"
                  id={`filter-${field}`}
                  value={filters[field]}
                  onChange={(event) => change({ [field]: event.target.value })}
                />
              </div>
            ))}
            <div className={styles.field}>
              <label htmlFor="expense-page-size">Expense page size</label>
              <select
                id="expense-page-size"
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
        advancedSupplement={
          <CategoryPicker
            org={org.id}
            value={filters.categoryId}
            onChange={(categoryId) => change({ categoryId })}
            optional
          />
        }
      />
      {!valid ? (
        <p role="alert">
          Check vendor text, category ID and valid ordered dates (at most 1,825 days apart).
        </p>
      ) : settling || list.isPending || list.isFetching ? (
        <p role="status">Loading expenses…</p>
      ) : list.isError ? (
        <>
          <ExpenseError
            error={list.error}
            retry={() => {
              void list.refetch();
            }}
          />
          {list.error instanceof ApiError && list.error.code === 'INVALID_CURSOR' && (
            <button onClick={() => setCursors([undefined])}>Restart expense pagination</button>
          )}
        </>
      ) : (
        <section className={styles.panel}>
          {!list.data.data.length ? (
            <p role="status">No expenses match these filters.</p>
          ) : (
            <>
              <p>Showing {list.data.data.length} expenses on this page.</p>
              <table className={styles.table}>
                <caption>Expense history</caption>
                <thead>
                  <tr>
                    {[
                      'Description',
                      'Category',
                      'Amount',
                      'Expense date',
                      'Vendor / reference',
                      'Status',
                      'Actions',
                    ].map((label) => (
                      <th scope="col" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map((expense) => (
                    <tr key={expense.id}>
                      <th scope="row">
                        <Link to={`${base}/${expense.id}`}>{expense.description}</Link>
                      </th>
                      <td data-label="Category">
                        {expense.category.name}
                        {expense.category.status === 'ARCHIVED' && ' (archived)'}
                      </td>
                      <td data-label="Amount">
                        {formatInvoiceMoney(expense.amount, expense.currency)} {expense.currency}
                      </td>
                      <td data-label="Expense date">{expense.expenseDate}</td>
                      <td data-label="Vendor / reference">
                        {expense.vendorPayee ?? 'Not set'}
                        <br />
                        {expense.reference ?? 'No reference'}
                      </td>
                      <td
                        data-label="Status"
                        className={expense.status === 'ACTIVE' ? styles.success : styles.warning}
                      >
                        {expense.status}
                      </td>
                      <td data-label="Actions">
                        <Link to={`${base}/${expense.id}`}>View</Link>
                        {expense.status === 'ACTIVE' && context.hasPermission('expense.update') && (
                          <>
                            {' '}
                            · <Link to={`${base}/${expense.id}/edit`}>Edit expense</Link>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <nav className={styles.pagination} aria-label="Expense pagination">
            <button
              disabled={cursors.length === 1}
              onClick={() => setCursors((old) => old.slice(0, -1))}
            >
              Previous expenses
            </button>
            <span>Expense page {cursors.length}</span>
            <button
              disabled={!list.data.meta.hasMore}
              onClick={() => {
                if (list.data.meta.nextCursor)
                  setCursors((old) => [...old, list.data.meta.nextCursor!]);
              }}
            >
              Next expenses
            </button>
          </nav>
        </section>
      )}
    </div>
  );
}
export function ExpenseCreatePage() {
  const context = useOrganization();
  return (
    <ExpenseBoundary permission="expense.create">
      {context.organization && <ExpenseForm key={context.organization.id} />}
    </ExpenseBoundary>
  );
}
export function ExpenseDetailsPage() {
  return <ExpenseRoute edit={false} />;
}
export function ExpenseEditPage() {
  return <ExpenseRoute edit />;
}
function ExpenseRoute({ edit }: { edit: boolean }) {
  const context = useOrganization();
  const { expenseId } = useParams();
  return (
    <ExpenseBoundary permission={edit ? 'expense.update' : 'expense.read'}>
      {context.organization &&
        (expenseId && organizationIdPattern.test(expenseId) ? (
          <ExpenseRecord
            key={`${context.organization.id}:${expenseId}`}
            id={expenseId}
            edit={edit}
          />
        ) : (
          <p role="alert">Expense not found.</p>
        ))}
    </ExpenseBoundary>
  );
}
function ExpenseRecord({ id, edit }: { id: string; edit: boolean }) {
  const org = useOrganization().organization!;
  const { user } = useAuth();
  const detail = useExpenseDetail(org.id, org.baseCurrency, id);
  const reload = () => {
    void detail.refetch();
  };
  if (detail.isPending || detail.isFetching) return <p role="status">Loading expense…</p>;
  if (detail.isError) return <ExpenseError error={detail.error} retry={reload} />;
  if (edit)
    return detail.data.expense.status === 'ACTIVE' ? (
      <ExpenseForm
        key={`${user!.id}:${id}:${detail.data.etag}`}
        resource={detail.data}
        reload={reload}
      />
    ) : (
      <section className={styles.panel}>
        <h1>Expense is voided</h1>
        <p>This retained expense is immutable and cannot be edited.</p>
        <Link to={`/organizations/${org.id}/expenses/${id}`}>View expense</Link>
      </section>
    );
  return <ExpenseDetails resource={detail.data} reload={reload} />;
}
function ExpenseDetails({ resource, reload }: { resource: ExpenseResource; reload: () => void }) {
  const context = useOrganization();
  const org = context.organization!;
  const e = resource.expense;
  const [voiding, setVoiding] = useState(false);
  const base = `/organizations/${org.id}/expenses`;
  const time = (value: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: org.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  return (
    <section className={styles.panel}>
      <Link to={base}>Back to expenses</Link>
      <h1>Expense details</h1>
      <p className={e.status === 'ACTIVE' ? styles.success : styles.warning}>{e.status}</p>
      <dl className={styles.details}>
        {[
          ['Expense ID', e.id],
          ['Description', e.description],
          ['Amount', `${formatInvoiceMoney(e.amount, e.currency)} ${e.currency}`],
          ['Expense date', e.expenseDate],
          ['Category', `${e.category.name} · ${e.category.status}`],
          ['Vendor / payee', e.vendorPayee ?? 'Not set'],
          ['Reference', e.reference ?? 'Not set'],
          ['Notes', e.notes ?? 'Not set'],
          ['Recorded by', e.createdByUserId],
          ['Created at', time(e.createdAt)],
          ['Updated at', time(e.updatedAt)],
          ['Version', String(e.version)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {e.status === 'VOIDED' && (
        <section aria-label="Expense void evidence">
          <h2>Voided expense</h2>
          <p>
            Excluded from current-state financial reports. The original record remains; no bank
            transfer is reversed.
          </p>
          <dl className={styles.details}>
            {[
              ['Void reason', e.voidReason!],
              ['Voided by', e.voidedByUserId!],
              ['Voided at', time(e.voidedAt!)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <div className={styles.actions}>
        {e.status === 'ACTIVE' && context.hasPermission('expense.update') && (
          <Link className={styles.primary} to={`${base}/${e.id}/edit`}>
            Edit expense
          </Link>
        )}
        {e.status === 'ACTIVE' && context.hasPermission('expense.void') && (
          <button className={styles.danger} onClick={() => setVoiding(true)}>
            Void expense
          </button>
        )}
      </div>
      {voiding && context.hasPermission('expense.void') && (
        <LifecycleDialog
          target={{ kind: 'void', resource }}
          close={() => setVoiding(false)}
          reload={reload}
        />
      )}
    </section>
  );
}
