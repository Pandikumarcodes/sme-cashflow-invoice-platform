import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, isAbortError } from '../../api/errors';
import { organizationKeys } from '../../organizations/query-keys';
import { invoiceKeys } from '../invoices/queries';
import { invalidateFinancialReads } from '../financials/query-keys';
import { getPayment, listPayments, submitPayment, type PaymentAttempt } from './api';
import type { PaymentFilters } from './contracts';
export const paymentKeys = {
  scope: (account: string, org: string) =>
    [...organizationKeys.scope(account, org), 'payments'] as const,
  list: (account: string, org: string, currency: string, filters: PaymentFilters, after?: string) =>
    [...paymentKeys.scope(account, org), 'list', currency, filters, after ?? null] as const,
  detail: (account: string, org: string, currency: string, id: string) =>
    [...paymentKeys.scope(account, org), 'detail', currency, id] as const,
};
export function usePaymentList(
  org: string,
  currency: string,
  filters: PaymentFilters,
  after?: string,
  enabled = true,
) {
  const { session, user } = useAuth();
  return useQuery({
    queryKey: paymentKeys.list(user!.id, org, currency, filters, after),
    enabled,
    staleTime: 0,
    gcTime: 0,
    queryFn: ({ signal }) => listPayments(session, org, currency, filters, after, signal),
  });
}
export function usePaymentDetail(org: string, currency: string, id: string) {
  const { session, user } = useAuth();
  return useQuery({
    queryKey: paymentKeys.detail(user!.id, org, currency, id),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) => getPayment(session, org, currency, id, signal),
  });
}
export function usePaymentAttempt(
  org: string,
  currency: string,
  operation: PaymentAttempt['operation'],
  resourceId: string,
) {
  const { session, user } = useAuth();
  const client = useQueryClient();
  const attemptKey = [
    ...paymentKeys.scope(user!.id, org),
    'pending-attempt',
    currency,
    operation,
    resourceId,
  ];
  const controller = useRef(new AbortController());
  const lock = useRef(false);
  const [attempt, setAttempt] = useState<PaymentAttempt | undefined>(() =>
    client.getQueryData<PaymentAttempt>(attemptKey),
  );
  const saved = useRef<PaymentAttempt | undefined>(attempt);
  const [error, setError] = useState<string | undefined>(() =>
    attempt
      ? 'A previous attempt has no confirmed outcome. Reconcile or retry its original key.'
      : undefined,
  );
  const [uncertain, setUncertain] = useState(!!attempt);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  const mutation = useMutation({
    mutationKey: [...paymentKeys.scope(user!.id, org), 'command'],
    retry: false,
    gcTime: 0,
    mutationFn: async (input: PaymentAttempt) => {
      const signal = controller.current.signal;
      const result = await submitPayment(session, org, currency, input, signal);
      if (signal.aborted) throw new DOMException('Operation canceled.', 'AbortError');
      return result;
    },
  });
  const send = async (
    input?:
      | Omit<Extract<PaymentAttempt, { operation: 'record' }>, 'key'>
      | Omit<Extract<PaymentAttempt, { operation: 'reverse' }>, 'key'>,
  ) => {
    if (lock.current || blocked || mutation.isSuccess || (!input && !saved.current)) return;
    // A saved attempt is immutable. UI edits can never substitute its payload or resource.
    const current =
      saved.current ??
      (input
        ? ({ ...input, body: { ...input.body }, key: crypto.randomUUID() } as PaymentAttempt)
        : undefined);
    if (!current) return;
    if (current.operation !== operation || current.resourceId !== resourceId) return;
    saved.current = current;
    // Survives permission revalidation/remounts within this account/tenant runtime.
    // Organization/account teardown removes this scope; nothing reaches browser storage.
    client.setQueryDefaults(attemptKey, { gcTime: Infinity });
    client.setQueryData(attemptKey, current);
    setAttempt(current);
    lock.current = true;
    setError(undefined);
    try {
      await mutation.mutateAsync(current);
      if (controller.current.signal.aborted) return;
      client.removeQueries({ queryKey: attemptKey, exact: true });
      setUncertain(false);
      void client.invalidateQueries({ queryKey: paymentKeys.scope(user!.id, org) });
      void client.invalidateQueries({ queryKey: invoiceKeys.scope(user!.id, org) });
      invalidateFinancialReads(client, user!.id, org, [
        'dashboard',
        'cash-flow',
        'profit-loss',
        'receivables-aging',
      ]);
    } catch (failure) {
      if (isAbortError(failure) || controller.current.signal.aborted) return;
      const unknown =
        !(failure instanceof ApiError) || failure.kind !== 'http' || (failure.status ?? 0) >= 500;
      // A later rejection cannot disprove an earlier uncertain commit (for example,
      // authorization may have changed before the retry reached its stored receipt).
      const unresolved = uncertain || unknown;
      setUncertain(unresolved);
      setError(
        failure instanceof ApiError
          ? ({
              PAYMENT_ALREADY_REVERSED:
                'This payment was already reversed. Reload its current details.',
              PAYMENT_EXCEEDS_BALANCE:
                'The remaining invoice balance changed. Reload the invoice before recording.',
              INVOICE_SETTLEMENT_INCONSISTENT:
                'Invoice settlement requires review. No new payment attempt is available here.',
              INVALID_INVOICE_STATE:
                'The invoice is no longer eligible for payment changes. Reload its details.',
              IDEMPOTENCY_CONFLICT:
                'This attempt conflicts with an existing receipt. Reconcile payment history before continuing.',
            }[failure.code] ?? failure.message)
          : 'The financial outcome could not be confirmed.',
      );
      // Even a definitive rejection never silently starts a new logical attempt.
      setBlocked(!unresolved);
      if (!unresolved) client.removeQueries({ queryKey: attemptKey, exact: true });
    } finally {
      lock.current = false;
    }
  };
  return { ...mutation, attempt, error, uncertain, blocked, send };
}
