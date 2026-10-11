import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import styles from '../features/auth/AuthPages.module.css';

export function SessionLoading() {
  return (
    <div className={styles.loading} role="status">
      <span className={styles.loader} aria-hidden="true" />
      <p>Checking your session…</p>
    </div>
  );
}
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'checking') return <SessionLoading />;
  if (status === 'unauthenticated')
    return (
      <Navigate
        to="/login"
        replace
        state={{ returnTo: location.pathname + location.search + location.hash }}
      />
    );
  return <Outlet />;
}
