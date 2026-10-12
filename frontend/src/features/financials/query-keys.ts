import type { QueryClient } from '@tanstack/react-query';
import { organizationKeys } from '../../organizations/query-keys';
import type { Period, CashGrouping, ProfitGrouping } from './contracts';
import type { DateRange } from '../dashboard/dates';
export const financialKeys = {
  scope: (
    account: string,
    org: string,
    kind: 'dashboard' | 'cash-flow' | 'profit-loss' | 'receivables-aging',
  ) => [...organizationKeys.scope(account, org), kind] as const,
  cash: (
    account: string,
    org: string,
    currency: string,
    timezone: string,
    range: Period,
    groupBy: CashGrouping,
  ) =>
    [
      ...financialKeys.scope(account, org, 'cash-flow'),
      currency,
      timezone,
      range.fromDate,
      range.toDate,
      groupBy,
    ] as const,
  profit: (
    account: string,
    org: string,
    currency: string,
    timezone: string,
    range: Period,
    groupBy: ProfitGrouping,
  ) =>
    [
      ...financialKeys.scope(account, org, 'profit-loss'),
      currency,
      timezone,
      range.fromDate,
      range.toDate,
      groupBy,
    ] as const,
  aging: (account: string, org: string, currency: string, timezone: string, asOfDate: string) =>
    [
      ...financialKeys.scope(account, org, 'receivables-aging'),
      currency,
      timezone,
      asOfDate,
    ] as const,
  summary: (account: string, org: string, currency: string, timezone: string, range: DateRange) =>
    [
      ...financialKeys.scope(account, org, 'dashboard'),
      currency,
      timezone,
      range.fromDate,
      range.toDate,
      range.asOfDate,
      'month',
    ] as const,
};
export function invalidateFinancialReads(
  client: QueryClient,
  account: string,
  org: string,
  kinds: ('dashboard' | 'cash-flow' | 'profit-loss' | 'receivables-aging')[],
) {
  for (const kind of kinds)
    void client.invalidateQueries({ queryKey: financialKeys.scope(account, org, kind) });
}
