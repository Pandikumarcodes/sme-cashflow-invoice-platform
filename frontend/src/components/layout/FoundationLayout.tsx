import { Link, Outlet } from 'react-router-dom';
import styles from './FoundationLayout.module.css';

export function FoundationLayout() {
  return (
    <div className={styles.frame}>
      <a className={styles.skip} href="#main-content">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link className={styles.brand} to="/" aria-label="Cashflow home">
          <span className={styles.mark} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M5 16V8h5v8M14 16V5h5v11M3 19h18" stroke="currentColor" strokeWidth="2" />
            </svg>
          </span>
          <span>
            cashflow<span className={styles.brandDetail}>SME WORKSPACE</span>
          </span>
        </Link>
        <span className={styles.phase}>FOUNDATION · 01</span>
        <Link className={styles.navigation} to="/login">
          Sign in <span aria-hidden="true">↗</span>
        </Link>
      </header>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <span>Built for the business you’re building.</span>
        <span>SME Cash Flow & Invoice Management</span>
      </footer>
    </div>
  );
}
