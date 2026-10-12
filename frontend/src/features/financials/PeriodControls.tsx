import { useState } from 'react';
import { presetRange, type Preset } from '../dashboard/dates';
import { reportRangeError, type Period } from './contracts';
import styles from './Financials.module.css';
export function PeriodControls({
  range,
  groupBy,
  groups,
  today,
  apply,
}: {
  range: Period;
  groupBy: string;
  groups: readonly string[];
  today: string;
  apply: (range: Period, groupBy: string) => void;
}) {
  const [draft, setDraft] = useState({ ...range });
  const [error, setError] = useState<string>();
  const presets = ['current-month', 'previous-month', 'last-90-days'] as const;
  const initialPreset =
    presets.find((preset) => {
      const p = presetRange(preset, today);
      return range.fromDate === p.fromDate && range.toDate === p.toDate;
    }) ?? 'custom';
  const [selected, setSelected] = useState<Preset>(initialPreset);
  return (
    <form
      className={styles.filters}
      aria-label="Financial period controls"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const failure = reportRangeError(draft.fromDate, draft.toDate);
        setError(failure);
        if (!failure) apply(draft, groupBy);
      }}
    >
      <div>
        <label htmlFor="financial-preset">Report period</label>
        <select
          id="financial-preset"
          value={selected}
          onChange={(event) => {
            const preset = event.target.value as Preset;
            setSelected(preset);
            if (preset === 'custom') return;
            const values = presetRange(preset, today);
            apply({ fromDate: values.fromDate, toDate: values.toDate }, groupBy);
          }}
        >
          <option value="current-month">Current month</option>
          <option value="previous-month">Previous month</option>
          <option value="last-90-days">Last 90 days</option>
          <option value="custom">Custom dates</option>
        </select>
      </div>
      <div>
        <label htmlFor="financial-from">From date</label>
        <input
          id="financial-from"
          type="date"
          value={draft.fromDate}
          onChange={(event) => {
            setSelected('custom');
            setDraft((old) => ({ ...old, fromDate: event.target.value }));
          }}
        />
      </div>
      <div>
        <label htmlFor="financial-to">To date</label>
        <input
          id="financial-to"
          type="date"
          value={draft.toDate}
          onChange={(event) => {
            setSelected('custom');
            setDraft((old) => ({ ...old, toDate: event.target.value }));
          }}
        />
      </div>
      <div>
        <label htmlFor="financial-group">Group financial report by</label>
        <select
          id="financial-group"
          value={groupBy}
          onChange={(event) => apply(range, event.target.value)}
        >
          {!groups.includes(groupBy) && <option value={groupBy}>Invalid grouping</option>}
          {groups.map((group) => (
            <option key={group} value={group}>
              {group === 'none' ? 'No time series' : group}
            </option>
          ))}
        </select>
      </div>
      <button>Apply report period</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
