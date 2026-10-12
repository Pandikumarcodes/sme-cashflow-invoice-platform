import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { getCashFlow, getProfitLoss } from './api';
import { financialKeys } from './query-keys';
import type { Period, CashGrouping, ProfitGrouping } from './contracts';
import { parseDashboardSummary, parseDashboard } from '../dashboard/contracts';
import type { DateRange } from '../dashboard/dates';
import type { Organization } from '../../organizations/contracts';
const fresh = {
  staleTime: 0,
  gcTime: 0,
  refetchOnWindowFocus: (query: { state: { status: string } }) => query.state.status !== 'error',
};
export function useCashFlow(
  org: Organization,
  range: Period,
  groupBy: CashGrouping,
  enabled = true,
) {
  const { user, session } = useAuth();
  return useQuery({
    queryKey: financialKeys.cash(user!.id, org.id, org.baseCurrency, org.timezone, range, groupBy),
    ...fresh,
    enabled,
    queryFn: ({ signal }) =>
      getCashFlow(session, org.id, org.baseCurrency, org.timezone, range, groupBy, signal),
  });
}
export function useProfitLoss(
  org: Organization,
  range: Period,
  groupBy: ProfitGrouping,
  enabled = true,
) {
  const { user, session } = useAuth();
  return useQuery({
    queryKey: financialKeys.profit(
      user!.id,
      org.id,
      org.baseCurrency,
      org.timezone,
      range,
      groupBy,
    ),
    ...fresh,
    enabled,
    queryFn: ({ signal }) =>
      getProfitLoss(session, org.id, org.baseCurrency, org.timezone, range, groupBy, signal),
  });
}
export function useDashboardFinancial(org: Organization, range: DateRange) {
  const { user, session } = useAuth();
  const cash = useCashFlow(org, { fromDate: range.fromDate, toDate: range.toDate }, 'month');
  const summary = useQuery({
    queryKey: financialKeys.summary(user!.id, org.id, org.baseCurrency, org.timezone, range),
    ...fresh,
    queryFn: async ({ signal }) =>
      parseDashboardSummary(
        (
          await session.request(`/organizations/${org.id}/analytics/summary`, {
            query: range,
            signal,
          })
        ).body,
        range,
        org.baseCurrency,
        org.timezone,
      ),
  });
  return {
    isPending: cash.isPending || summary.isPending,
    isFetching: cash.isFetching || summary.isFetching,
    isError: cash.isError || summary.isError,
    error: summary.error ?? cash.error,
    data:
      cash.data && summary.data && !cash.isError && !summary.isError
        ? parseDashboard(summary.data, cash.data, range, org.baseCurrency, org.timezone)
        : undefined,
    refetch: () => Promise.all([summary.refetch(), cash.refetch()]),
  };
}
