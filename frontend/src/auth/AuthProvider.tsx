import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AuthContext } from './AuthContext';
import { currentUserKey, parseAuthResponse, userResponseSchema } from './contracts';
import type { Session } from './session';

export function AuthProvider({ session, children }: { session: Session; children: ReactNode }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { data: user } = useQuery({
    queryKey: currentUserKey,
    enabled: state.status === 'authenticated',
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) =>
      parseAuthResponse(userResponseSchema, (await session.request('/me', { signal })).body).data,
  });
  useEffect(() => {
    void session.restore();
  }, [session]);
  return (
    <AuthContext.Provider
      value={{ ...state, user: state.status === 'authenticated' ? user : undefined, session }}
    >
      {children}
    </AuthContext.Provider>
  );
}
