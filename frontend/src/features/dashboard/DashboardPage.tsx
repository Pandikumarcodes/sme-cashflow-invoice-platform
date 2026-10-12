import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/errors';
import { useOrganization } from '../../organizations/OrganizationContext';
import { OrganizationWorkspace, PermissionBoundary } from '../../organizations/Workspace';
import type { Organization } from '../../organizations/contracts';
import { localToday, presetRange, rangeError, type DateRange, type Preset } from './dates';
import { useDashboardFinancial } from '../financials/queries';
import { FinancialDecimal, formatMoney } from './money';
import { CashChart } from './CashChart';
import styles from './Dashboard.module.css';

export default function DashboardPage() {
  const context = useOrganization();
  if (context.status !== 'ready' || !context.organization) return <OrganizationWorkspace />;
  return (
    <PermissionBoundary permission="analytics.read">
      <DashboardOverview
        key={`${context.organization.id}:${context.organization.baseCurrency}:${context.organization.timezone}`}
        organization={context.organization}
      />
    </PermissionBoundary>
  );
}
function DashboardOverview({ organization }: { organization: Organization }) {
  const today = localToday(organization.timezone);
  const [preset, setPreset] = useState<Preset>('current-month');
  const [custom, setCustom] = useState(() => presetRange('current-month', today));
  const [draft, setDraft] = useState(custom);
  const [validation, setValidation] = useState<string>();
  const range: DateRange =
    preset === 'custom' ? { ...custom, asOfDate: today } : presetRange(preset, today);
  const financial = useDashboardFinancial(organization, range);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const error = rangeError(draft.fromDate, draft.toDate, today);
    setValidation(error);
    if (!error) setCustom({ ...draft, asOfDate: today });
  };
  const data = financial.isError || financial.isFetching ? undefined : financial.data;
  const money = (value: string) => formatMoney(value, organization.baseCurrency);
  const totals = data?.summary.data;
  const metrics = totals
    ? [
        {
          label: 'Cash inflow',
          value: totals.collections.collected,
          note: 'Recorded payments in range',
          tone: 'positive',
        },
        {
          label: 'Cash outflow',
          value: totals.spending.expenses,
          note: 'Active expenses in range',
          tone: 'neutral',
        },
        {
          label: 'Net cash flow',
          value: totals.cash.netCashFlow,
          note: 'Simplified cash-basis net result',
          tone: new FinancialDecimal(totals.cash.netCashFlow).isNegative()
            ? 'negative'
            : 'positive',
        },
        {
          label: 'Total invoiced',
          value: totals.billing.totalInvoiced,
          note: 'Currently issued invoices by issue date',
          tone: 'neutral',
        },
        {
          label: 'Outstanding receivables',
          value: totals.receivables.outstanding,
          note: `All eligible issued invoices as of ${today}`,
          tone: 'neutral',
        },
        {
          label: 'Overdue receivables',
          value: totals.receivables.overdue,
          note: `Positive balances due before ${today}`,
          tone: 'warning',
        },
      ]
    : [];
  return (
    <div className={styles.dashboard}>
      <header className={styles.heading}>
        <p>{organization.displayName ?? organization.legalName}</p>
        <h1>Financial overview</h1>
        <p>
          {organization.baseCurrency} · {organization.timezone}
        </p>
      </header>
      <form className={styles.filters} onSubmit={submit} aria-label="Dashboard date range">
        <div>
          <label htmlFor="dashboard-range">Date range</label>
          <select
            id="dashboard-range"
            value={preset}
            onChange={(event) => {
              const next = event.target.value as Preset;
              setValidation(undefined);
              if (next === 'custom') {
                setCustom(range);
                setDraft(range);
              }
              setPreset(next);
            }}
          >
            <option value="current-month">Current month</option>
            <option value="previous-month">Previous month</option>
            <option value="last-90-days">Last 90 days</option>
            <option value="custom">Custom range</option>
          </select>
        </div>
        {preset === 'custom' && (
          <>
            <div>
              <label htmlFor="dashboard-from">From date</label>
              <input
                id="dashboard-from"
                type="date"
                required
                max={today}
                value={draft.fromDate}
                aria-invalid={!!validation}
                aria-describedby={validation ? 'range-error' : undefined}
                onChange={(event) => setDraft({ ...draft, fromDate: event.target.value })}
              />
            </div>
            <div>
              <label htmlFor="dashboard-to">To date</label>
              <input
                id="dashboard-to"
                type="date"
                required
                value={draft.toDate}
                aria-invalid={!!validation}
                aria-describedby={validation ? 'range-error' : undefined}
                onChange={(event) => setDraft({ ...draft, toDate: event.target.value })}
              />
            </div>
            <button type="submit">Apply range</button>
          </>
        )}
        {validation && (
          <p role="alert" id="range-error">
            {validation}
          </p>
        )}
      </form>
      <p className={styles.range}>
        Cash and billing dates: {range.fromDate} through {range.toDate}, inclusive. Receivables as
        of {range.asOfDate}.
      </p>
      <p className={styles.disclosure}>
        Simplified cash-basis performance. Collected cash is also cash-basis revenue; net cash flow
        is the net result. Not a GAAP/IFRS financial statement. Current corrected states apply; this
        is not a historical snapshot or bank balance.
      </p>
      {financial.isPending || financial.isFetching ? (
        <p role="status" className={styles.panel}>
          Loading financial overview…
        </p>
      ) : financial.isError ? (
        <section className={styles.panel}>
          <h2>
            {financial.error instanceof ApiError && financial.error.status === 403
              ? 'Access denied'
              : financial.error instanceof ApiError && financial.error.status === 404
                ? 'Organization unavailable'
                : 'Financial overview unavailable'}
          </h2>
          <p role="alert">
            {financial.error instanceof ApiError && financial.error.status === 403
              ? 'You do not have permission to view these analytics.'
              : financial.error instanceof ApiError && financial.error.status === 404
                ? 'Organization access could not be verified. Refresh access or choose another organization.'
                : 'Financial data could not be loaded or verified. Please try again.'}
          </p>
          <button
            type="button"
            onClick={() => {
              void financial.refetch();
            }}
          >
            Retry financial overview
          </button>
        </section>
      ) : (
        data && (
          <>
            <section aria-label="Financial summary" className={styles.metrics}>
              {metrics.map((metric) => (
                <article key={metric.label} className={styles.metric}>
                  <h2>{metric.label}</h2>
                  <p className={styles[metric.tone]}>{money(metric.value)}</p>
                  <small>{metric.note}</small>
                </article>
              ))}
            </section>
            {metrics.every((metric) => new FinancialDecimal(metric.value).isZero()) &&
              new FinancialDecimal(data.cash.data.inflows).isZero() &&
              new FinancialDecimal(data.cash.data.outflows).isZero() && (
                <p role="status" className={styles.panel}>
                  No financial activity or receivable balances for these dates.
                </p>
              )}
            <CashChart cash={data.cash} />
            <p className={styles.disclosure}>
              Receivables include current issued invoices issued through {today}, less recorded
              payments through that date, regardless of the cash range. Due today is not overdue.
              Summary cards and the trend are separate backend reads and may reflect different
              concurrent updates.
            </p>
          </>
        )
      )}
    </div>
  );
}
