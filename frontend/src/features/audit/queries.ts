import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { organizationKeys } from '../../organizations/query-keys';
import { listAudit } from './api';
import type { AuditFilters } from './contracts';
export const auditKeys = {
  scope: (account: string, org: string) =>
    [...organizationKeys.scope(account, org), 'audit-logs'] as const,
  list: (account: string, org: string, filters: AuditFilters, after?: string) =>
    [...auditKeys.scope(account, org), filters, after ?? null] as const,
};
export function useAudit(org: string, filters: AuditFilters, after?: string) {
  const { session, user } = useAuth();
  return useQuery({
    queryKey: auditKeys.list(user!.id, org, filters, after),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => listAudit(session, org, filters, after, signal),
  });
}
