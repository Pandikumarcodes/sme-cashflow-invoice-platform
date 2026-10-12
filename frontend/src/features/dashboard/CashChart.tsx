import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { CashFlow } from './contracts';
import { chartPoints, formatMoney } from './money';
import styles from './Dashboard.module.css';
export function CashChart({ cash }: { cash: CashFlow }) {
  const { points, maximum } = chartPoints(cash.data.series);
  return (
    <section className={styles.panel} aria-labelledby="cash-chart-title">
      <h2 id="cash-chart-title">Cash inflow versus outflow</h2>
      <p>
        Recorded payments and active expenses by month. Partial months include only dates in the
        selected range.
      </p>
      {!points.length ? (
        <p role="status">No cash activity in this range.</p>
      ) : (
        <>
          <p id="cash-chart-summary">
            Highest monthly amount: {formatMoney(maximum, cash.meta.currency)}. Bar heights show
            relative amounts; exact values follow below.
          </p>
          <div
            className={styles.chart}
            role="img"
            aria-labelledby="cash-chart-title"
            aria-describedby="cash-chart-summary"
          >
            <ResponsiveContainer
              width="100%"
              height={300}
              initialDimension={{ width: 600, height: 300 }}
            >
              <BarChart data={points} accessibilityLayer={false}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="periodStart" stroke="var(--color-secondary-text)" />
                <YAxis
                  domain={[0, 1]}
                  ticks={[0, 0.5, 1]}
                  tickFormatter={(value: number) => `${value * 100}%`}
                  stroke="var(--color-secondary-text)"
                />
                <Legend />
                <Bar
                  dataKey="incoming"
                  name="Cash inflow"
                  fill="var(--color-success)"
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="outgoing"
                  name="Cash outflow"
                  fill="var(--color-warning)"
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <caption>Exact monthly cash values ({cash.meta.currency})</caption>
              <thead>
                <tr>
                  <th scope="col">Period start</th>
                  <th scope="col">Inflow</th>
                  <th scope="col">Outflow</th>
                  <th scope="col">Net cash flow</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.periodStart}>
                    <th scope="row">{point.periodStart}</th>
                    <td>{formatMoney(point.inflows, cash.meta.currency)}</td>
                    <td>{formatMoney(point.outflows, cash.meta.currency)}</td>
                    <td>{formatMoney(point.netCashFlow, cash.meta.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
