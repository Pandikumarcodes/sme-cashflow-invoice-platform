import { createContext, useContext } from 'react';
import type { Session, SessionState } from './session';
import type { User } from './contracts';

export const AuthContext = createContext<
  (SessionState & { user?: User; session: Session }) | undefined
>(undefined);
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('Authentication requires the application provider.');
  return value;
}
