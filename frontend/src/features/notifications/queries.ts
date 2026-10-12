import { useEffect, useRef } from 'react';
import { useMutation, useQuery, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { organizationKeys } from '../../organizations/query-keys';
import { listNotifications, changeNotification } from './api';
import type { NotificationFilters, NotificationAction, NotificationPage } from './contracts';
export const notificationKeys = {
  scope: (account: string, org: string) =>
    [...organizationKeys.scope(account, org), 'notifications'] as const,
  list: (account: string, org: string, filters: NotificationFilters, after?: string) =>
    [...notificationKeys.scope(account, org), 'list', filters, after ?? null] as const,
};
export function useNotifications(org: string, filters: NotificationFilters, after?: string) {
  const { session, user } = useAuth();
  return useQuery<NotificationPage>({
    queryKey: notificationKeys.list(user!.id, org, filters, after),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: (query) => query.state.status !== 'error',
    queryFn: ({ signal }) => listNotifications(session, org, filters, after, signal),
  });
}
export function useNotificationCommand(org: string) {
  const { session, user } = useAuth();
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  const command = useMutation({
    mutationKey: [...notificationKeys.scope(user!.id, org), 'change-state'],
    retry: false,
    gcTime: 0,
    mutationFn: async ({ id, action }: { id: string; action: NotificationAction }) => {
      const signal = controller.current.signal;
      const result = await changeNotification(session, org, id, action, signal);
      if (signal.aborted) throw new DOMException('Operation canceled.', 'AbortError');
      return result;
    },
  });
  return { ...command, isCurrent: () => !controller.current.signal.aborted };
}
export function invalidateNotificationReads(client: QueryClient, account: string, org: string) {
  void client.invalidateQueries({ queryKey: notificationKeys.scope(account, org) });
}
