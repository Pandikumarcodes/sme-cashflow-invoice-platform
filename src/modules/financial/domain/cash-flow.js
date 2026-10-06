import { businessDate } from '../../../common/time/business-date.js';
import { Decimal, moneyString } from '../../../common/money/decimal.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';

export function cashFlowOptions(query, timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year').value.padStart(4, '0');
  const month = parts.find((part) => part.type === 'month').value;
  const first = `${year}-${month}-01`;
  const last = businessDate(first);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  const fromDate = query.fromDate ?? first;
  const toDate = query.toDate ?? last.toISOString().slice(0, 10);
  const days = (businessDate(toDate) - businessDate(fromDate)) / 86400000 + 1;
  const groupBy = query.groupBy ?? 'month';
  if (days < 1 || days > 366 || !['day', 'week', 'month'].includes(groupBy)) {
    throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Invalid cash flow range or grouping.');
  }
  return { fromDate, toDate, groupBy };
}

// PostgreSQL has already grouped authoritative facts. Never apply record-sized
// amount limits to report sums, or subtract reversal records a second time.
export function cashFlowResponse(rows, options, organization) {
  let inflows = new Decimal(0);
  let outflows = new Decimal(0);
  const series = rows.map((row) => {
    if (row.currencyMismatch) {
      throw new ApplicationError(
        ERROR_CODES.CURRENCY_MISMATCH,
        'Financial currency is inconsistent.',
      );
    }
    const incoming = new Decimal(row.inflows);
    const outgoing = new Decimal(row.outflows);
    inflows = inflows.plus(incoming);
    outflows = outflows.plus(outgoing);
    return {
      periodStart: row.periodStart.toISOString().slice(0, 10),
      inflows: moneyString(incoming, organization.baseCurrency),
      outflows: moneyString(outgoing, organization.baseCurrency),
      netCashFlow: moneyString(incoming.minus(outgoing), organization.baseCurrency),
    };
  });
  return {
    data: {
      inflows: moneyString(inflows, organization.baseCurrency),
      outflows: moneyString(outflows, organization.baseCurrency),
      netCashFlow: moneyString(inflows.minus(outflows), organization.baseCurrency),
      series,
    },
    meta: {
      ...options,
      currency: organization.baseCurrency,
      timezone: organization.timezone,
      basis: 'cash',
    },
  };
}
