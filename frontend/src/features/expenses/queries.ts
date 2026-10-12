import { useEffect, useRef } from 'react';
import { useMutation, useQuery, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { organizationKeys } from '../../organizations/query-keys';
import { invalidateFinancialReads } from '../financials/query-keys';
import { getExpense, listCategories, listExpenses } from './api';
import type { CategoryFilters, ExpenseFilters } from './contracts';
export const expenseKeys = {
  scope: (account: string, org: string) =>
    [...organizationKeys.scope(account, org), 'expenses'] as const,
  list: (account: string, org: string, currency: string, filters: ExpenseFilters, after?: string) =>
    [...expenseKeys.scope(account, org), 'list', currency, filters, after ?? null] as const,
  detail: (account: string, org: string, currency: string, id: string) =>
    [...expenseKeys.scope(account, org), 'detail', currency, id] as const,
};
export const categoryKeys = {
  scope: (account: string, org: string) =>
    [...organizationKeys.scope(account, org), 'expense-categories'] as const,
  list: (account: string, org: string, filters: CategoryFilters, after?: string) =>
    [...categoryKeys.scope(account, org), 'list', filters, after ?? null] as const,
};
export function useCategoryList(org: string, filters: CategoryFilters, after?: string) {
  const { session, user } = useAuth();
  return useQuery({
    queryKey: categoryKeys.list(user!.id, org, filters, after),
    staleTime: 0,
    gcTime: 0,
    queryFn: ({ signal }) => listCategories(session, org, filters, after, signal),
  });
}
export function useExpenseList(
  org: string,
  currency: string,
  filters: ExpenseFilters,
  after?: string,
  enabled = true,
) {
  const { session, user } = useAuth();
  return useQuery({
    queryKey: expenseKeys.list(user!.id, org, currency, filters, after),
    enabled,
    staleTime: 0,
    gcTime: 0,
    queryFn: ({ signal }) => listExpenses(session, org, currency, filters, after, signal),
  });
}
export function useExpenseDetail(org: string, currency: string, id: string) {
  const { session, user } = useAuth();
  return useQuery({
    queryKey: expenseKeys.detail(user!.id, org, currency, id),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) => getExpense(session, org, currency, id, signal),
  });
}
export function useExpenseCommand<T, R>(
  org: string,
  operation: string,
  request: (input: T, signal: AbortSignal) => Promise<R>,
) {
  const { user } = useAuth();
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  const command = useMutation({
    mutationKey: [...expenseKeys.scope(user!.id, org), operation],
    retry: false,
    gcTime: 0,
    mutationFn: async (input: T) => {
      const signal = controller.current.signal;
      const result = await request(input, signal);
      if (signal.aborted) throw new DOMException('Operation canceled.', 'AbortError');
      return result;
    },
  });
  return { ...command, isCurrent: () => !controller.current.signal.aborted };
}
export function invalidateExpenseReads(client: QueryClient, account: string, org: string) {
  void client.invalidateQueries({ queryKey: expenseKeys.scope(account, org) });
  void client.invalidateQueries({ queryKey: categoryKeys.scope(account, org) });
  invalidateFinancialReads(client, account, org, ['dashboard', 'cash-flow', 'profit-loss']);
}
