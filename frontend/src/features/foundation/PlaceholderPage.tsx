import { Link } from 'react-router-dom';
import styles from './FoundationPage.module.css';

export function NotFoundPage() {
  return (
    <section className={styles.placeholder}>
      <p className={styles.eyebrow}>404 · Page not found</p>
      <h1>A little off course.</h1>
      <p>The page you’re looking for doesn’t exist. Let’s return to the workspace.</p>
      <Link className={styles.primary} to="/">
        Return to workspace <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
