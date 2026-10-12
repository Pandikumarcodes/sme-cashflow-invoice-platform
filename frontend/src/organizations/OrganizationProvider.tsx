import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/errors';
import { OrganizationContext, type OrganizationStatus } from './OrganizationContext';
import {
  organizationIdPattern,
  parseOrganization,
  parseOrganizations,
  type Organization,
} from './contracts';
import { grants, type Permission } from './permissions';
import { readSelection, saveSelection } from './selection';
import { organizationKeys } from './query-keys';
export function OrganizationProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { organizationId: selectedId } = useParams();
  const [hint] = useState(() => readSelection(accountId));
  const fresh = {
    staleTime: 0,
    gcTime: 0,
    retry: false as const,
    refetchOnWindowFocus: 'always' as const,
    refetchOnReconnect: 'always' as const,
    refetchInterval: (query: { state: { status: string } }) =>
      query.state.status === 'error' ? (false as const) : 60_000,
  };
  const list = useQuery<Organization[]>({
    ...fresh,
    queryKey: organizationKeys.list(accountId),
    queryFn: async ({ signal }) =>
      parseOrganizations((await session.request('/organizations', { signal })).body),
  });
  const organizations = useMemo(
    () => (list.isError || list.isFetching ? [] : (list.data ?? [])),
    [list.isError, list.isFetching, list.data],
  );
  const accessible =
    !!selectedId &&
    organizationIdPattern.test(selectedId) &&
    organizations.some((o) => o.id === selectedId);
  const detail = useQuery<Organization>({
    ...fresh,
    refetchInterval: (query) => (query.state.status === 'error' ? false : 60_000),
    queryKey: organizationKeys.context(accountId, selectedId ?? ''),
    enabled: (query) => accessible && query.state.status !== 'error',
    queryFn: async ({ signal }) =>
      parseOrganization(
        (await session.request(`/organizations/${selectedId}`, { signal })).body,
        selectedId!,
      ),
  });
  useEffect(() => {
    if (!selectedId && organizations.length) {
      const id = organizations.find((o) => o.id === hint)?.id ?? organizations[0]!.id;
      void navigate(`/organizations/${id}/workspace`, { replace: true });
    }
  }, [selectedId, organizations, hint, navigate]);
  // URL changes (including browser history) abort/remove the old tenant's complete cache scope.
  useEffect(() => {
    if (!selectedId) return;
    return () => {
      void queryClient.cancelQueries({ queryKey: organizationKeys.scope(accountId, selectedId) });
      queryClient.removeQueries({ queryKey: organizationKeys.scope(accountId, selectedId) });
    };
  }, [accountId, selectedId, queryClient]);
  let status: OrganizationStatus = 'loading';
  if (list.isError) status = 'error';
  else if (!list.isFetching && list.data) {
    if (selectedId && !accessible) status = 'inaccessible';
    else if (!organizations.length) status = 'empty';
    else if (accessible && !detail.isFetching) {
      if (detail.isError)
        status =
          detail.error instanceof ApiError && detail.error.status === 404
            ? 'inaccessible'
            : detail.error instanceof ApiError && detail.error.status === 403
              ? 'forbidden'
              : 'error';
      else if (detail.data)
        status =
          detail.data.status === 'ACTIVE' && detail.data.membership.status === 'ACTIVE'
            ? 'ready'
            : 'inaccessible';
    }
  }
  const organization = status === 'ready' ? detail.data : undefined;
  const permissions = organization ? grants(organization.membership.role, true) : [];
  useEffect(() => {
    if (organization) saveSelection(accountId, organization.id);
  }, [accountId, organization]);
  return (
    <OrganizationContext.Provider
      value={{
        status,
        organizations,
        selectedId,
        organization,
        membership: organization?.membership,
        permissions,
        hasPermission: (permission) =>
          status === 'ready' && permissions.includes(permission as Permission),
        switchOrganization: (id) => {
          if (!organizations.some((o) => o.id === id)) return;
          if (id === selectedId) return;
          if (selectedId) {
            void queryClient.cancelQueries({
              queryKey: organizationKeys.scope(accountId, selectedId),
            });
            queryClient.removeQueries({ queryKey: organizationKeys.scope(accountId, selectedId) });
          }
          void navigate(
            `/organizations/${id}/${['customers', 'invoices', 'payments', 'expenses', 'expense-categories', 'cash-flow', 'profit-loss', 'receivables-aging', 'notifications'].includes(location.pathname.split('/')[3] ?? '') ? location.pathname.split('/')[3] : location.pathname.endsWith('/dashboard') ? 'dashboard' : 'workspace'}`,
          );
        },
        retry: () => {
          void list.refetch();
          if (accessible) void detail.refetch();
        },
        clearSelection: () => saveSelection(accountId),
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}
