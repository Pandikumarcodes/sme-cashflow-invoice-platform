import { useSearchParams, Link } from 'react-router-dom';
import { useOrganization } from '../../organizations/OrganizationContext';
import { localToday, presetRange } from '../dashboard/dates';
import { FinancialDecimal, formatMoney } from '../dashboard/money';
import { useCashFlow, useProfitLoss } from './queries';
import { reportRangeError, type CashGrouping, type ProfitGrouping } from './contracts';
import { FinancialBoundary, FinancialError, FinancialLoading, Metrics } from './states';
import { PeriodControls } from './PeriodControls';
import { ComparisonChart } from './FinancialChart';
import styles from './Financials.module.css';
export function CashFlowPage() {
  const context = useOrganization();
  return (
    <FinancialBoundary>
      {context.organization && (
        <CashFlow
          key={`${context.organization.id}:${context.organization.baseCurrency}:${context.organization.timezone}`}
        />
      )}
    </FinancialBoundary>
  );
}
export function ProfitLossPage() {
  const context = useOrganization();
  return (
    <FinancialBoundary>
      {context.organization && (
        <ProfitLoss
          key={`${context.organization.id}:${context.organization.baseCurrency}:${context.organization.timezone}`}
        />
      )}
    </FinancialBoundary>
  );
}
function usePeriod() {
  const org = useOrganization().organization!;
  const [params, setParams] = useSearchParams();
  const today = localToday(org.timezone);
  const initial = presetRange('current-month', today);
  const range = {
    fromDate: params.get('fromDate') ?? initial.fromDate,
    toDate: params.get('toDate') ?? initial.toDate,
  };
  const group = params.get('groupBy') ?? 'month';
  return {
    org,
    today,
    range,
    group,
    apply: (next: typeof range, groupBy: string) => setParams({ ...next, groupBy }),
  };
}
const netTone = (value: string) =>
  new FinancialDecimal(value).isNegative() ? ('negative' as const) : ('positive' as const);
function CashFlow() {
  const { org, today, range, group, apply } = usePeriod();
  const valid =
    !reportRangeError(range.fromDate, range.toDate) && ['day', 'week', 'month'].includes(group);
  const report = useCashFlow(org, range, valid ? (group as CashGrouping) : 'month', valid);
  const data = valid && !report.isFetching && !report.isError ? report.data : undefined;
  return (
    <div className={styles.dashboard}>
      <header className={styles.heading}>
        <Link to={`/organizations/${org.id}/dashboard`}>Financial overview</Link>
        <h1>Cash Flow</h1>
        <p>Recorded cash inflow and paid expense outflow for {org.displayName ?? org.legalName}.</p>
      </header>
      <PeriodControls
        key={`${range.fromDate}:${range.toDate}:${group}`}
        range={range}
        groupBy={group}
        groups={['day', 'week', 'month']}
        today={today}
        apply={apply}
      />
      <p className={styles.disclosure}>
        Current-state cash view: RECORDED payments by payment date and ACTIVE expenses by expense
        date. Reversed payments and voided expenses are excluded, including corrections outside this
        range. This is not a bank balance or retained historical snapshot. Weeks start Monday;
        partial periods include only selected dates. Missing periods are not filled.
      </p>
      {!valid ? (
        <p role="alert">
          {reportRangeError(range.fromDate, range.toDate) ?? 'Choose day, week or month grouping.'}
        </p>
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
              Report period: {data.meta.fromDate} – {data.meta.toDate} · {data.meta.timezone} ·{' '}
              {data.meta.groupBy}
            </p>
            <Metrics
              currency={data.meta.currency}
              values={[
                {
                  label: 'Cash inflow',
                  amount: formatMoney(data.data.inflows, data.meta.currency),
                  tone: 'positive',
                },
                {
                  label: 'Cash outflow',
                  amount: formatMoney(data.data.outflows, data.meta.currency),
                  tone: 'warning',
                },
                {
                  label: 'Net cash flow',
                  amount: formatMoney(data.data.netCashFlow, data.meta.currency),
                  tone: netTone(data.data.netCashFlow),
                },
              ]}
            />
            <ComparisonChart
              series={data.data.series}
              currency={data.meta.currency}
              labels={['Cash inflow', 'Cash outflow']}
              title="Cash inflow and outflow by period"
              id="cash-period-chart"
            />
            <section className={styles.panel}>
              <div
                className={styles.tableWrap}
                tabIndex={0}
                role="region"
                aria-label="Scrollable exact cash values"
              >
                <table>
                  <caption>Exact cash values ({data.meta.currency})</caption>
                  <thead>
                    <tr>
                      {['Period start', 'Inflow', 'Outflow', 'Net cash flow'].map((label) => (
                        <th scope="col" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.series.map((row) => (
                      <tr key={row.periodStart}>
                        <th scope="row">{row.periodStart}</th>
                        <td>{formatMoney(row.inflows, data.meta.currency)}</td>
                        <td>{formatMoney(row.outflows, data.meta.currency)}</td>
                        <td>{formatMoney(row.netCashFlow, data.meta.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )
      )}
    </div>
  );
}
function ProfitLoss() {
  const { org, today, range, group, apply } = usePeriod();
  const valid =
    !reportRangeError(range.fromDate, range.toDate) && ['none', 'month'].includes(group);
  const report = useProfitLoss(org, range, valid ? (group as ProfitGrouping) : 'month', valid);
  const data = valid && !report.isFetching && !report.isError ? report.data : undefined;
  return (
    <div className={styles.dashboard}>
      <header className={styles.heading}>
        <Link to={`/organizations/${org.id}/dashboard`}>Financial overview</Link>
        <h1>Profit &amp; Loss</h1>
        <p>Simplified cash-basis performance for {org.displayName ?? org.legalName}.</p>
      </header>
      <PeriodControls
        key={`${range.fromDate}:${range.toDate}:${group}`}
        range={range}
        groupBy={group}
        groups={['none', 'month']}
        today={today}
        apply={apply}
      />
      <p className={styles.disclosure}>
        Simplified cash-basis view based on recorded payments and active expenses. This is not a
        formal accrual-accounting profit and loss statement. Reversed/voided facts are excluded by
        current state, including later corrections. Category names reflect current names; archived
        categories with active expenses remain included.
      </p>
      {!valid ? (
        <p role="alert">
          {reportRangeError(range.fromDate, range.toDate) ?? 'Choose none or month grouping.'}
        </p>
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
            <p className={styles.disclosure}>{data.meta.disclaimer}</p>
            <p className={styles.range}>
              Report period: {data.meta.fromDate} – {data.meta.toDate} · {data.meta.timezone}
            </p>
            <Metrics
              currency={data.meta.currency}
              values={[
                {
                  label: 'Revenue',
                  amount: formatMoney(data.data.revenue, data.meta.currency),
                  tone: 'positive',
                },
                {
                  label: 'Expenses',
                  amount: formatMoney(data.data.expenses, data.meta.currency),
                  tone: 'warning',
                },
                {
                  label: 'Net result',
                  amount: formatMoney(data.data.netResult, data.meta.currency),
                  tone: netTone(data.data.netResult),
                },
              ]}
            />
            {data.data.series && (
              <>
                <ComparisonChart
                  series={data.data.series.map((row) => ({
                    periodStart: row.periodStart,
                    inflows: row.revenue,
                    outflows: row.expenses,
                    netCashFlow: row.netResult,
                  }))}
                  currency={data.meta.currency}
                  labels={['Revenue', 'Expenses']}
                  title="Revenue versus expenses by month"
                  id="profit-period-chart"
                />
                <section className={styles.panel}>
                  <div
                    className={styles.tableWrap}
                    tabIndex={0}
                    role="region"
                    aria-label="Scrollable exact monthly performance"
                  >
                    <table>
                      <caption>Exact monthly cash-basis performance ({data.meta.currency})</caption>
                      <thead>
                        <tr>
                          {['Period start', 'Revenue', 'Expenses', 'Net result'].map((label) => (
                            <th scope="col" key={label}>
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.data.series.map((row) => (
                          <tr key={row.periodStart}>
                            <th scope="row">{row.periodStart}</th>
                            <td>{formatMoney(row.revenue, data.meta.currency)}</td>
                            <td>{formatMoney(row.expenses, data.meta.currency)}</td>
                            <td>{formatMoney(row.netResult, data.meta.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
            <section className={styles.panel}>
              <h2>Expense category breakdown</h2>
              {!data.data.expenseByCategory.length && (
                <p role="status">No active expense amounts in this range.</p>
              )}
              <div
                className={styles.tableWrap}
                tabIndex={0}
                role="region"
                aria-label="Scrollable expense breakdown"
              >
                <table>
                  <caption>Exact expense category values ({data.meta.currency})</caption>
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col">Expenses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.expenseByCategory.map((category) => (
                      <tr key={category.categoryId}>
                        <th scope="row">{category.categoryName}</th>
                        <td>{formatMoney(category.amount, data.meta.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )
      )}
    </div>
  );
}
