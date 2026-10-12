import { useEffect, useState } from 'react';
import { useCustomerList } from '../customers/queries';
import styles from './Invoices.module.css';
export function CustomerPicker({
  organizationId,
  value,
  label,
  onChange,
  disabled,
  invalid,
  describedBy,
  optional = false,
}: {
  organizationId: string;
  value: string;
  label?: string;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
  optional?: boolean;
}) {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [selected, setSelected] = useState(label ?? 'Selected customer');
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const valid = input === '' || (input.length >= 2 && input.length <= 100 && /\S/.test(input));
  useEffect(() => {
    if (!valid || input === search) return;
    const timer = window.setTimeout(() => {
      setSearch(input);
      setCursors([undefined]);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [input, search, valid]);
  const query = useCustomerList(
    organizationId,
    { status, search, sortBy: 'displayName', sortOrder: 'asc', limit: 25 },
    cursors.at(-1),
    valid && input === search,
  );
  const data =
    !query.isFetching && !query.isError && valid && input === search ? query.data : undefined;
  return (
    <fieldset className={styles.picker} disabled={disabled}>
      <legend>{optional ? 'Customer filter' : 'Customer'}</legend>
      {optional && (
        <div className={styles.field}>
          <label htmlFor="invoice-choice-status">Customer choice status</label>
          <select
            id="invoice-choice-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as 'ACTIVE' | 'ARCHIVED');
              setCursors([undefined]);
            }}
          >
            <option value="ACTIVE">Active customers</option>
            <option value="ARCHIVED">Archived customers</option>
          </select>
        </div>
      )}
      <div className={styles.field}>
        <label htmlFor="invoice-customer-search">
          {optional ? 'Find customers' : 'Find active customers'}
        </label>
        <input
          id="invoice-customer-search"
          type="search"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          maxLength={100}
        />
        <small>Search names or emails using 2–100 characters.</small>
      </div>
      {!valid ? (
        <p role="status">Enter at least two characters or clear customer search.</p>
      ) : query.isError ? (
        <div>
          <p role="alert">Active customers could not be loaded.</p>
          <button
            type="button"
            onClick={() => {
              setCursors([undefined]);
              void query.refetch();
            }}
          >
            Retry customers
          </button>
        </div>
      ) : !data ? (
        <p role="status">Loading customer choices…</p>
      ) : (
        !data.data.length && (
          <p role="status">
            No active customers match. Create an active customer before invoicing.
          </p>
        )
      )}
      <div className={styles.field}>
        <label htmlFor="invoice-customer">
          {optional ? 'Filter by customer' : 'Invoice customer'}
        </label>
        <select
          id="invoice-customer"
          value={value}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(event) => {
            setSelected(
              data?.data.find((customer) => customer.id === event.target.value)?.displayName ??
                selected,
            );
            onChange(event.target.value);
          }}
          disabled={disabled || !data}
        >
          <option value="">{optional ? 'All customers' : 'Select an active customer'}</option>
          {value && !data?.data.some((customer) => customer.id === value) && (
            <option value={value}>{selected} (current selection)</option>
          )}
          {data?.data.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.displayName}
              {customer.customerCode ? ` · ${customer.customerCode}` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={!data || cursors.length === 1}
          onClick={() => setCursors((previous) => previous.slice(0, -1))}
        >
          Previous customers
        </button>
        <span>Customer page {cursors.length}</span>
        <button
          type="button"
          disabled={!data?.meta.hasMore}
          onClick={() => {
            if (data?.meta.nextCursor)
              setCursors((previous) => [...previous, data.meta.nextCursor!]);
          }}
        >
          Next customers
        </button>
      </div>
    </fieldset>
  );
}
