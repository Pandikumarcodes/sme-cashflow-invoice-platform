import { cashFlowOptions } from './cash-flow.js';
import { businessDate, localDate } from '../../../common/time/business-date.js';
import { Decimal, moneyString } from '../../../common/money/decimal.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';

export const AGING_BUCKETS = ['CURRENT', '1_30', '31_60', '61_90', '91_PLUS'];
export const analyticsDate = localDate;
export function analyticsOptions(query, timezone, summary = true, now = new Date()) {
  const asOfDate = query.asOfDate ?? analyticsDate(timezone, now);
  businessDate(asOfDate);
  if (!summary) return { asOfDate };
  const { fromDate, toDate } = cashFlowOptions(
    { fromDate: query.fromDate, toDate: query.toDate },
    timezone,
    now,
  );
  if (asOfDate < fromDate)
    throw new ApplicationError(
      ERROR_CODES.INVALID_REQUEST,
      'As-of date cannot precede the cohort range.',
    );
  return { fromDate, toDate, asOfDate };
}
export function validateAnalyticsFacts(row) {
  if (row.currencyMismatch)
    throw new ApplicationError(
      ERROR_CODES.CURRENCY_MISMATCH,
      'Financial currency is inconsistent.',
    );
  if (row.invalidSettlement)
    throw new ApplicationError(
      ERROR_CODES.INVOICE_SETTLEMENT_INCONSISTENT,
      'Invoice settlement requires review.',
    );
}
export function analyticsSummaryResponse(row, cash, activeCount, options, organization) {
  validateAnalyticsFacts(row);
  const amount = (value) => moneyString(value, organization.baseCurrency);
  const total = new Decimal(row.totalInvoiced);
  return {
    data: {
      billing: {
        totalInvoiced: amount(total),
        invoiceCounts: {
          DRAFT: row.draftCount,
          ISSUED: row.issuedCount,
          CANCELLED: row.cancelledCount,
          VOID: row.voidCount,
        },
      },
      collections: {
        collected: cash.data.inflows,
        rate: total.isZero()
          ? null
          : new Decimal(row.cohortCollected).div(total).times(100).toFixed(4),
        averagePaymentDelayDays:
          row.sampleSize === 0 ? null : new Decimal(row.delayDays).div(row.sampleSize).toFixed(2),
        sampleSize: row.sampleSize,
      },
      receivables: { outstanding: amount(row.outstanding), overdue: amount(row.overdue) },
      spending: { expenses: cash.data.outflows },
      cash: { netCashFlow: cash.data.netCashFlow, netResult: cash.data.netCashFlow },
      customers: { activeCount },
    },
    meta: analyticsMeta(options, organization, true),
  };
}
export function analyticsMeta(options, organization, summary = false) {
  const meta = {
    ...options,
    currency: organization.baseCurrency,
    timezone: organization.timezone,
    basis: 'CURRENT_STATE',
    receivablesBasis: 'CURRENT_ISSUED_ISSUE_DATE_THROUGH_AS_OF_RECORDED_PAYMENTS_THROUGH_AS_OF',
  };
  if (summary) {
    meta.collectionRateBasis = 'CURRENT_ISSUED_IN_ISSUE_DATE_RANGE_RECORDED_PAYMENTS_THROUGH_AS_OF';
    meta.collectionRateUnit = 'PERCENT';
    meta.paymentDelayBasis = 'FULLY_PAID_COHORT_FINAL_PAYMENT_DATE_MINUS_DUE_DATE';
    meta.cashBasis = 'PAYMENT_DATE_AND_EXPENSE_DATE_IN_RANGE';
    meta.customerCountBasis = 'CURRENT_ACTIVE';
  }
  return meta;
}
export function agingResponse(rows, options, organization) {
  let outstanding = new Decimal(0),
    overdue = new Decimal(0);
  const buckets = AGING_BUCKETS.map((bucket) => {
    const row = rows.find((value) => value.bucket === bucket);
    if (row) validateAnalyticsFacts(row);
    const amount = new Decimal(row?.amount ?? 0);
    outstanding = outstanding.plus(amount);
    if (bucket !== 'CURRENT') overdue = overdue.plus(amount);
    return {
      bucket,
      invoiceCount: row?.invoiceCount ?? 0,
      amount: moneyString(amount, organization.baseCurrency),
    };
  });
  // Invalid facts with no positive balance must still fail closed.
  for (const row of rows) validateAnalyticsFacts(row);
  return {
    data: {
      outstanding: moneyString(outstanding, organization.baseCurrency),
      overdue: moneyString(overdue, organization.baseCurrency),
      buckets,
    },
    meta: analyticsMeta(options, organization),
  };
}
