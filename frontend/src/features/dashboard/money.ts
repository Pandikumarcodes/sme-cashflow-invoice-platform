import Decimal from 'decimal.js-light';
export const FinancialDecimal = Decimal.clone({ precision: 64, rounding: Decimal.ROUND_HALF_UP });
export function formatMoney(value: string, currency: string) {
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  const scale = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const amount = new FinancialDecimal(value);
  const [integer = '0', fraction = ''] = amount.abs().toFixed(scale).split('.');
  const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    BigInt(integer),
  );
  // BigInt groups the integer exactly. Decimal preserves the currency fraction; no Number money.
  return formatter
    .formatToParts(amount.isNegative() && !amount.isZero() ? -1n : 1n)
    .map((part) =>
      part.type === 'integer' ? grouped : part.type === 'fraction' ? fraction : part.value,
    )
    .join('');
}
export type CashPeriod = {
  periodStart: string;
  inflows: string;
  outflows: string;
  netCashFlow: string;
};
export function chartPoints(series: CashPeriod[]) {
  let max = new FinancialDecimal(0);
  for (const period of series)
    for (const value of [period.inflows, period.outflows])
      if (new FinancialDecimal(value).gt(max)) max = new FinancialDecimal(value);
  return {
    maximum: max.toString(),
    points: series.map((period) => ({
      ...period,
      // Recharts receives approximate dimensionless coordinates only. Exact money stays alongside.
      incoming: max.isZero() ? 0 : new FinancialDecimal(period.inflows).div(max).toNumber(),
      outgoing: max.isZero() ? 0 : new FinancialDecimal(period.outflows).div(max).toNumber(),
    })),
  };
}
