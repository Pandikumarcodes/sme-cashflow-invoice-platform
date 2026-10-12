import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { organizationKeys } from '../../organizations/query-keys';
import { getCustomer, listCustomers } from './api';
import type { CustomerFilters, CustomerResource, CustomerList } from './contracts';
export const customerKeys = {
  scope: (account: string, organization: string) =>
    [...organizationKeys.scope(account, organization), 'customers'] as const,
  list: (account: string, organization: string, filters: CustomerFilters, after?: string) =>
    [...customerKeys.scope(account, organization), 'list', filters, after ?? null] as const,
  detail: (account: string, organization: string, id: string) =>
    [...customerKeys.scope(account, organization), 'detail', id] as const,
};
export function useCustomerList(
  organizationId: string,
  filters: CustomerFilters,
  after?: string,
  enabled = true,
) {
  const { session, user } = useAuth();
  return useQuery<CustomerList>({
    queryKey: customerKeys.list(user!.id, organizationId, filters, after),
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: (query) => query.state.status !== 'error',
    queryFn: ({ signal }) => listCustomers(session, organizationId, filters, after, signal),
  });
}
export function useCustomerDetail(organizationId: string, id: string) {
  const { session, user } = useAuth();
  return useQuery({
    queryKey: customerKeys.detail(user!.id, organizationId, id),
    staleTime: 0,
    gcTime: 0,
    // Explicit reload protects an edit draft from silent background version changes.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) => getCustomer(session, organizationId, id, signal),
  });
}
export function useCustomerCommand<T>(
  organizationId: string,
  command: string,
  request: (input: T, signal: AbortSignal) => Promise<CustomerResource>,
) {
  const { user } = useAuth();
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  const mutation = useMutation({
    mutationKey: [...customerKeys.scope(user!.id, organizationId), command],
    retry: false,
    gcTime: 0,
    mutationFn: async (input: T) => {
      const signal = controller.current.signal;
      const result = await request(input, signal);
      if (signal.aborted) throw new DOMException('Operation canceled.', 'AbortError');
      return result;
    },
  });
  return { ...mutation, isCurrent: () => !controller.current.signal.aborted };
}
