import { useState } from 'react';
import { ApiError } from '../../api/errors';
import { useCategoryList } from './queries';
import type { Expense } from './contracts';
import styles from './Expenses.module.css';
export function CategoryPicker({
  org,
  value,
  onChange,
  disabled = false,
  existing,
  optional = false,
  invalid = false,
}: {
  org: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  existing?: Expense['category'];
  optional?: boolean;
  invalid?: boolean;
}) {
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const query = useCategoryList(org, { status, limit: 25 }, cursors.at(-1));
  const rows = !query.isFetching && !query.isError ? query.data?.data : undefined;
  return (
    <fieldset className={styles.panel} disabled={disabled}>
      <legend>{optional ? 'Category filter choices' : 'Expense category'}</legend>
      {optional && (
        <div className={styles.field}>
          <label htmlFor="category-choice-status">Category choice status</label>
          <select
            id="category-choice-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as 'ACTIVE' | 'ARCHIVED');
              setCursors([undefined]);
            }}
          >
            <option>ACTIVE</option>
            <option>ARCHIVED</option>
          </select>
        </div>
      )}
      {query.isPending || query.isFetching ? (
        <p role="status">Loading expense categories…</p>
      ) : query.isError ? (
        <>
          <p role="alert">
            {query.error instanceof ApiError ? query.error.message : 'Categories unavailable.'}
          </p>
          <button
            type="button"
            onClick={() => {
              if (query.error instanceof ApiError && query.error.code === 'INVALID_CURSOR')
                setCursors([undefined]);
              else void query.refetch();
            }}
          >
            Retry category choices
          </button>
        </>
      ) : (
        <>
          <div className={styles.field}>
            <label htmlFor={optional ? 'expense-category-filter' : 'expense-category'}>
              {optional ? 'Filter by category' : 'Select expense category'}
            </label>
            <select
              id={optional ? 'expense-category-filter' : 'expense-category'}
              value={value}
              aria-invalid={invalid}
              aria-describedby={!optional && invalid ? 'expense-category-error' : undefined}
              onChange={(event) => onChange(event.target.value)}
            >
              <option value="">{optional ? 'All categories' : 'Choose active category'}</option>
              {existing && !rows?.some((row) => row.id === existing.id) && (
                <option value={existing.id}>
                  {existing.name} · {existing.status} (existing assignment)
                </option>
              )}
              {value && !existing && !rows?.some((row) => row.id === value) && (
                <option value={value}>Selected category on another page</option>
              )}
              {rows?.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </div>
          {!rows?.length && <p role="status">No {status.toLowerCase()} categories on this page.</p>}
          <nav className={styles.pagination} aria-label="Category choice pagination">
            <button
              type="button"
              disabled={cursors.length === 1}
              onClick={() => setCursors((old) => old.slice(0, -1))}
            >
              Previous category choices
            </button>
            <span>Category choice page {cursors.length}</span>
            <button
              type="button"
              disabled={!query.data?.meta.hasMore}
              onClick={() => {
                if (query.data?.meta.nextCursor)
                  setCursors((old) => [...old, query.data!.meta.nextCursor!]);
              }}
            >
              Next category choices
            </button>
          </nav>
        </>
      )}
      {existing?.status === 'ARCHIVED' && (
        <p>The existing archived assignment may be retained. New assignments must be active.</p>
      )}
    </fieldset>
  );
}
