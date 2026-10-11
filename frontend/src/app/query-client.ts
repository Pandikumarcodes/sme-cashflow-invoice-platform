import { QueryClient } from '@tanstack/react-query';
import { ApiError, isAbortError } from '../api/errors';

export function shouldRetryQuery(failureCount: number, error: unknown) {
  if (failureCount >= 1 || isAbortError(error)) return false;
  return (
    error instanceof ApiError &&
    (error.kind === 'network' ||
      (error.kind === 'http' && error.status !== undefined && error.status >= 500))
  );
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryQuery,
        retryDelay: 1_000,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

export const queryKeys = {
  resource: (name: string) => [name] as const,
  organization: (organizationId: string, resource: string) =>
    ['organization', organizationId, resource] as const,
};
