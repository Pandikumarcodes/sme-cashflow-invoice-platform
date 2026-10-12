import { agingBuckets } from '../analytics/contracts';
import { periodFloor, type Period, type CashGrouping, type ProfitGrouping } from './contracts';
export const range = { fromDate: '2024-02-14', toDate: '2024-03-10' };
export function cashReport(period: Period = range, group: CashGrouping = 'month') {
  return {
    data: {
      inflows: '12345678901234567890.10',
      outflows: '200.25',
      netCashFlow: '-10.15',
      series: [
        {
          periodStart: periodFloor(period.fromDate, group),
          inflows: '12345678901234567890.10',
          outflows: '200.25',
          netCashFlow: '-10.15',
        },
      ],
    },
    meta: { ...period, currency: 'USD', timezone: 'UTC', groupBy: group, basis: 'cash' },
  };
}
export function profitReport(period: Period = range, group: ProfitGrouping = 'month') {
  return {
    data: {
      revenue: '100.10',
      expenses: '200.25',
      netResult: '-100.15',
      expenseByCategory: [
        {
          categoryId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          categoryName: 'Archived rent',
          amount: '200.25',
        },
      ],
      ...(group === 'month'
        ? {
            series: [
              {
                periodStart: periodFloor(period.fromDate, 'month'),
                revenue: '100.10',
                expenses: '200.25',
                netResult: '-100.15',
              },
            ],
          }
        : {}),
    },
    meta: {
      ...period,
      currency: 'USD',
      timezone: 'UTC',
      groupBy: group,
      basis: 'SIMPLIFIED_CASH',
      disclaimer: 'Not a GAAP/IFRS financial statement.',
    },
  };
}
export function agingReport(asOfDate = '2024-03-10') {
  return {
    data: {
      outstanding: '500.00',
      overdue: '400.00',
      buckets: agingBuckets.map((bucket) => ({ bucket, invoiceCount: 1, amount: '100.00' })),
    },
    meta: {
      asOfDate,
      currency: 'USD',
      timezone: 'UTC',
      basis: 'CURRENT_STATE',
      receivablesBasis: 'CURRENT_ISSUED_ISSUE_DATE_THROUGH_AS_OF_RECORDED_PAYMENTS_THROUGH_AS_OF',
    },
  };
}
