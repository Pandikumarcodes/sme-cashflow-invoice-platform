import { Component, type ReactNode } from 'react';
import styles from './States.module.css';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className={styles.fallback} role="alert">
          <p className={styles.eyebrow}>Something went wrong</p>
          <h1>Let’s get you back on track.</h1>
          <p>We couldn’t display this page. Reload the application to try again.</p>
          <button onClick={() => window.location.reload()}>Reload application</button>
        </main>
      );
    return this.props.children;
  }
}
