import { Link } from 'react-router-dom';
import styles from './States.module.css';

export function RouteError() {
  return (
    <main className={styles.fallback} role="alert">
      <p className={styles.eyebrow}>Page unavailable</p>
      <h1>We couldn’t open this page.</h1>
      <p>Please return to the workspace and try again.</p>
      <Link to="/">Return to workspace</Link>
    </main>
  );
}
