import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import type { Organization } from '../../organizations/contracts';
import { financialKeys } from '../financials/query-keys';
import { getAging } from './api';
import type { AgingReport } from './contracts';
export function useAging(org: Organization, asOfDate: string, enabled = true) {
  const { user, session } = useAuth();
  return useQuery<AgingReport>({
    queryKey: financialKeys.aging(user!.id, org.id, org.baseCurrency, org.timezone, asOfDate),
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: (query) => query.state.status !== 'error',
    queryFn: ({ signal }) =>
      getAging(session, org.id, org.baseCurrency, org.timezone, asOfDate, signal),
  });
}
