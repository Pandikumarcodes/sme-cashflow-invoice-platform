import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useOrganization } from '../../organizations/OrganizationContext';
import { localToday, calendarDate } from '../dashboard/dates';
import { formatMoney, FinancialDecimal } from '../dashboard/money';
import { FinancialBoundary, FinancialLoading, FinancialError, Metrics } from '../financials/states';
import { DistributionChart } from '../financials/FinancialChart';
import { agingLabels } from './contracts';
import { useAging } from './queries';
import styles from '../financials/Financials.module.css';
export function AgingPage() {
  const context = useOrganization();
  return (
    <FinancialBoundary>
      {context.organization && (
        <Aging
          key={`${context.organization.id}:${context.organization.baseCurrency}:${context.organization.timezone}`}
        />
      )}
    </FinancialBoundary>
  );
}
function AsOfControl({ value, apply }: { value: string; apply: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string>();
  return (
    <form
      className={styles.filters}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!calendarDate(draft)) {
          setError('Enter a valid as-of calendar date.');
          return;
        }
        setError(undefined);
        apply(draft);
      }}
    >
      <div>
        <label htmlFor="aging-as-of">Receivables as-of date</label>
        <input
          id="aging-as-of"
          type="date"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <button>Apply as-of date</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
function Aging() {
  const org = useOrganization().organization!;
  const [params, setParams] = useSearchParams();
  const asOfDate = params.get('asOfDate') ?? localToday(org.timezone);
  const valid = !!calendarDate(asOfDate);
  const report = useAging(org, asOfDate, valid);
  const data = valid && !report.isFetching && !report.isError ? report.data : undefined;
  return (
    <div className={styles.dashboard}>
      <header className={styles.heading}>
        <Link to={`/organizations/${org.id}/dashboard`}>Financial overview</Link>
        <h1>Receivables Aging</h1>
        <p>Monitor unpaid invoices and overdue balances.</p>
      </header>
      <AsOfControl
        key={asOfDate}
        value={asOfDate}
        apply={(value) => setParams({ asOfDate: value })}
      />
      {!valid ? (
        <p role="alert">Enter a valid as-of calendar date.</p>
      ) : report.isPending || report.isFetching ? (
        <FinancialLoading />
      ) : report.isError ? (
        <FinancialError
          error={report.error}
          retry={() => {
            void report.refetch();
          }}
        />
      ) : (
        data && (
          <>
            <p className={styles.range}>
              As of {data.meta.asOfDate} · {data.meta.timezone} · Current-state receivables
            </p>
            <Metrics
              currency={data.meta.currency}
              values={[
                {
                  label: 'Total outstanding',
                  amount: formatMoney(data.data.outstanding, data.meta.currency),
                },
                {
                  label: 'Overdue receivables',
                  amount: formatMoney(data.data.overdue, data.meta.currency),
                  tone: 'warning',
                },
              ]}
            />
            {new FinancialDecimal(data.data.outstanding).isZero() && (
              <p role="status">No outstanding receivables as of this date.</p>
            )}
            <DistributionChart
              entries={data.data.buckets.map((bucket) => ({
                label: agingLabels[bucket.bucket],
                amount: bucket.amount,
                tone:
                  bucket.bucket === 'CURRENT'
                    ? 'var(--color-success)'
                    : bucket.bucket === '91_PLUS'
                      ? 'var(--color-danger)'
                      : 'var(--color-warning)',
              }))}
              currency={data.meta.currency}
              title="Receivables aging distribution"
              id="aging-distribution"
            />
            <p className={styles.disclosure}>
              Bucket colors: green for current, amber for 1–90 days overdue, red for 91+ days
              overdue. Exact labels and figures are in the table.
            </p>
            <section className={styles.panel}>
              <div
                className={styles.tableWrap}
                tabIndex={0}
                role="region"
                aria-label="Scrollable exact aging values"
              >
                <table>
                  <caption>Exact aging bucket values ({data.meta.currency})</caption>
                  <thead>
                    <tr>
                      <th scope="col">Backend bucket</th>
                      <th scope="col">Invoices with positive balance</th>
                      <th scope="col">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.buckets.map((bucket) => (
                      <tr key={bucket.bucket}>
                        <th scope="row">{agingLabels[bucket.bucket]}</th>
                        <td>{bucket.invoiceCount}</td>
                        <td>{formatMoney(bucket.amount, data.meta.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <p className={styles.disclosure}>
              This independent business-date view uses current issued invoices and recorded payments
              through the selected date. Due today is current; later lifecycle corrections affect
              the view, which is not a frozen historical snapshot.
            </p>
          </>
        )
      )}
    </div>
  );
}
