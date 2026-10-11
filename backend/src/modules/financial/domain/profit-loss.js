import { moneyString } from '../../../common/money/decimal.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { cashFlowOptions } from './cash-flow.js';

export function profitLossOptions(query, timezone, now = new Date()) {
  const groupBy = query.groupBy ?? 'month';
  if (!['none', 'month'].includes(groupBy)) {
    throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Invalid profit and loss grouping.');
  }
  const options = cashFlowOptions(
    { fromDate: query.fromDate, toDate: query.toDate, groupBy: 'month' },
    timezone,
    now,
  );
  return { ...options, groupBy };
}

// Both statements share the canonical current-state financial calculation.
export function profitLossResponse(cash, categories, options, organization) {
  const data = {
    revenue: cash.data.inflows,
    expenses: cash.data.outflows,
    netResult: cash.data.netCashFlow,
    expenseByCategory: categories.map((category) => ({
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      amount: moneyString(category.amount, organization.baseCurrency),
    })),
  };
  if (options.groupBy === 'month') {
    data.series = cash.data.series.map((period) => ({
      periodStart: period.periodStart,
      revenue: period.inflows,
      expenses: period.outflows,
      netResult: period.netCashFlow,
    }));
  }
  return {
    data,
    meta: {
      ...options,
      currency: organization.baseCurrency,
      timezone: organization.timezone,
      basis: 'SIMPLIFIED_CASH',
      disclaimer: 'Not a GAAP/IFRS financial statement.',
    },
  };
}
