import { useId, useState, type ReactNode } from 'react';
import styles from './OperationsFilterToolbar.module.css';

type OperationsFilterToolbarProps = {
  ariaLabel: string;
  primary: ReactNode;
  advanced: ReactNode;
  advancedSupplement?: ReactNode;
  activeAdvancedCount?: number;
  onClear?: () => void;
};

/** A deliberately small composition helper for operations-list filters. */
export function OperationsFilterToolbar({
  ariaLabel,
  primary,
  advanced,
  advancedSupplement,
  activeAdvancedCount = 0,
  onClear,
}: OperationsFilterToolbarProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const label = activeAdvancedCount
    ? `More filters (${activeAdvancedCount} active)`
    : 'More filters';

  return (
    <section className={styles.toolbar} aria-label={ariaLabel}>
      <div className={styles.primary}>{primary}</div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.more}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((value) => !value)}
        >
          {label}
        </button>
        {onClear && (
          <button type="button" className={styles.clear} onClick={onClear}>
            Clear filters
          </button>
        )}
      </div>
      <div id={panelId} className={styles.advanced} hidden={!expanded}>
        <div className={styles.advancedGrid}>{advanced}</div>
        {advancedSupplement && (
          <div className={styles.advancedSupplement}>{advancedSupplement}</div>
        )}
      </div>
    </section>
  );
}
