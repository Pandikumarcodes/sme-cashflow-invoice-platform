import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { organizationKeys } from '../../organizations/query-keys';
import { getInvoice, listInvoices } from './api';
import type { InvoiceFilters } from './contracts';
export const invoiceKeys = {
  scope: (account: string, org: string) =>
    [...organizationKeys.scope(account, org), 'invoices'] as const,
  list: (account: string, org: string, currency: string, filters: InvoiceFilters, after?: string) =>
    [...invoiceKeys.scope(account, org), 'list', currency, filters, after ?? null] as const,
  detail: (account: string, org: string, currency: string, id: string) =>
    [...invoiceKeys.scope(account, org), 'detail', currency, id] as const,
};
export function useInvoiceList(
  org: string,
  currency: string,
  filters: InvoiceFilters,
  after?: string,
  enabled = true,
) {
  const { session, user } = useAuth();
  return useQuery<Awaited<ReturnType<typeof listInvoices>>>({
    queryKey: invoiceKeys.list(user!.id, org, currency, filters, after),
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: (query) => query.state.status !== 'error',
    queryFn: ({ signal }) => listInvoices(session, org, currency, filters, after, signal),
  });
}
export function useInvoiceDetail(org: string, currency: string, id: string) {
  const { session, user } = useAuth();
  return useQuery({
    queryKey: invoiceKeys.detail(user!.id, org, currency, id),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) => getInvoice(session, org, currency, id, signal),
  });
}
export function useInvoiceCommand<T, R>(
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
    mutationKey: [...invoiceKeys.scope(user!.id, org), operation],
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
