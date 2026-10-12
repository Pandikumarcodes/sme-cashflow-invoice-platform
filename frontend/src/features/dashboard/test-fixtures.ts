import type { DateRange } from './dates';
export const dashboardOrg = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  legalName: 'Alpha Legal',
  displayName: 'Alpha',
  status: 'ACTIVE',
  baseCurrency: 'USD',
  timezone: 'UTC',
  membership: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', role: 'OWNER', status: 'ACTIVE' },
};
export const secondOrg = {
  ...dashboardOrg,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  displayName: 'Beta',
  membership: { ...dashboardOrg.membership, role: 'VIEWER' },
};
export function summaryFixture(range: DateRange, inflow = '1200.10', expenses = '400.05') {
  return {
    data: {
      billing: {
        totalInvoiced: '2000.00',
        invoiceCounts: { DRAFT: 1, ISSUED: 2, CANCELLED: 0, VOID: 0 },
      },
      collections: {
        collected: inflow,
        rate: '60.0050',
        averagePaymentDelayDays: '-2.00',
        sampleSize: 1,
      },
      receivables: { outstanding: '799.90', overdue: '300.00' },
      spending: { expenses },
      cash: { netCashFlow: '800.05', netResult: '800.05' },
      customers: { activeCount: 2 },
    },
    meta: {
      ...range,
      currency: 'USD',
      timezone: 'UTC',
      basis: 'CURRENT_STATE',
      receivablesBasis: 'CURRENT_ISSUED_ISSUE_DATE_THROUGH_AS_OF_RECORDED_PAYMENTS_THROUGH_AS_OF',
      collectionRateBasis: 'CURRENT_ISSUED_IN_ISSUE_DATE_RANGE_RECORDED_PAYMENTS_THROUGH_AS_OF',
      collectionRateUnit: 'PERCENT',
      paymentDelayBasis: 'FULLY_PAID_COHORT_FINAL_PAYMENT_DATE_MINUS_DUE_DATE',
      cashBasis: 'PAYMENT_DATE_AND_EXPENSE_DATE_IN_RANGE',
      customerCountBasis: 'CURRENT_ACTIVE',
    },
  };
}
export function cashFixture(range: DateRange, inflow = '1200.10', outflows = '400.05') {
  return {
    data: {
      inflows: inflow,
      outflows,
      netCashFlow: '800.05',
      series: [
        {
          periodStart: `${range.fromDate.slice(0, 7)}-01`,
          inflows: inflow,
          outflows,
          netCashFlow: '800.05',
        },
      ],
    },
    meta: {
      fromDate: range.fromDate,
      toDate: range.toDate,
      currency: 'USD',
      timezone: 'UTC',
      groupBy: 'month',
      basis: 'cash',
    },
  };
}
