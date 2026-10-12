import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { chartPoints, formatMoney, type CashPeriod } from '../dashboard/money';
import styles from './Financials.module.css';
type Point = {
  label: string;
  incoming: number;
  outgoing?: number;
  first: string;
  second?: string;
  tone?: string;
};
function ExactTooltip({
  active,
  payload,
  currency,
  labels,
}: {
  active?: boolean;
  payload?: readonly { payload: Point }[];
  currency: string;
  labels: readonly string[];
}) {
  const point = payload?.[0]?.payload;
  return active && point ? (
    <div className={styles.tooltip}>
      <strong>{point.label}</strong>
      <p>
        {labels[0]}: {formatMoney(point.first, currency)} {currency}
      </p>
      {point.second !== undefined && (
        <p>
          {labels[1]}: {formatMoney(point.second, currency)} {currency}
        </p>
      )}
    </div>
  ) : null;
}
function Chart({
  title,
  points,
  currency,
  labels,
  id,
}: {
  title: string;
  points: Point[];
  currency: string;
  labels: readonly string[];
  id: string;
}) {
  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <p id={`${id}-summary`}>
        Coordinates are relative to the largest returned amount, not accounting values. Exact server
        values are in the tables below. Hover for exact amounts.
      </p>
      {!points.length ? (
        <p role="status">No populated periods in this range.</p>
      ) : (
        <div
          className={styles.chart}
          role="img"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-summary`}
        >
          <ResponsiveContainer
            width="100%"
            height={300}
            initialDimension={{ width: 600, height: 300 }}
          >
            <BarChart data={points} accessibilityLayer={false}>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="label"
                label={{ value: 'Business period / bucket', position: 'insideBottom', offset: -4 }}
                height={65}
                stroke="var(--color-secondary-text)"
              />
              <YAxis
                domain={[0, 1]}
                ticks={[0, 0.5, 1]}
                tickFormatter={(value: number) => `${value * 100}%`}
                width={72}
                label={{ value: 'Relative amount', angle: -90, position: 'insideLeft' }}
                stroke="var(--color-secondary-text)"
              />
              <Legend />
              <Tooltip
                content={(props) => (
                  <ExactTooltip
                    active={props.active}
                    payload={props.payload as readonly { payload: Point }[] | undefined}
                    currency={currency}
                    labels={labels}
                  />
                )}
              />
              <Bar
                dataKey="incoming"
                name={labels[0]}
                fill="var(--color-success)"
                stroke="var(--color-primary-text)"
                isAnimationActive={false}
              >
                {points.map((point, index) => (
                  <Cell key={index} fill={point.tone ?? 'var(--color-success)'} />
                ))}
              </Bar>
              {labels.length > 1 && (
                <Bar
                  dataKey="outgoing"
                  name={labels[1]}
                  fill="var(--color-warning)"
                  stroke="var(--color-primary-text)"
                  isAnimationActive={false}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
export function ComparisonChart({
  series,
  currency,
  labels,
  title,
  id,
}: {
  series: CashPeriod[];
  currency: string;
  labels: readonly [string, string];
  title: string;
  id: string;
}) {
  const { points } = chartPoints(series);
  return (
    <Chart
      title={title}
      currency={currency}
      labels={labels}
      id={id}
      points={points.map((point) => ({
        label: point.periodStart,
        incoming: point.incoming,
        outgoing: point.outgoing,
        first: point.inflows,
        second: point.outflows,
      }))}
    />
  );
}
export function DistributionChart({
  entries,
  currency,
  title,
  id,
}: {
  entries: { label: string; amount: string; tone?: string }[];
  currency: string;
  title: string;
  id: string;
}) {
  const normalized = chartPoints(
    entries.map((entry) => ({
      periodStart: entry.label,
      inflows: entry.amount,
      outflows: '0',
      netCashFlow: '0',
    })),
  ).points;
  return (
    <Chart
      title={title}
      currency={currency}
      labels={['Outstanding amount']}
      id={id}
      points={entries.map((entry, index) => ({
        label: entry.label,
        first: entry.amount,
        incoming: normalized[index]!.incoming,
        tone: entry.tone,
      }))}
    />
  );
}
