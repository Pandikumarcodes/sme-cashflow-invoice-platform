import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, isAbortError } from '../../api/errors';
import { formatInvoiceMoney } from '../invoices/calculation';
import { voidSchema, type Category, type ExpenseResource } from './contracts';
import { archiveCategory, voidExpense } from './api';
import { invalidateExpenseReads, useExpenseCommand } from './queries';
import styles from './Expenses.module.css';
type Target = { kind: 'archive'; category: Category } | { kind: 'void'; resource: ExpenseResource };
export function LifecycleDialog({
  target,
  close,
  reload,
}: {
  target: Target;
  close: () => void;
  reload: () => void;
}) {
  const { session, user } = useAuth();
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [blocked, setBlocked] = useState(false);
  const org =
    target.kind === 'archive'
      ? target.category.organizationId
      : target.resource.expense.organizationId;
  const command = useExpenseCommand<string, Category | ExpenseResource>(
    org,
    target.kind,
    (value, signal) =>
      target.kind === 'archive'
        ? archiveCategory(session, org, target.category.id, signal)
        : voidExpense(
            session,
            org,
            target.resource.expense.currency,
            target.resource,
            value,
            signal,
          ),
  );
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    element.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  const submit = async () => {
    if (lock.current || blocked) return;
    if (target.kind === 'void' && !voidSchema.safeParse({ reason }).success) {
      setError('Enter a visible reason of at most 500 characters.');
      return;
    }
    lock.current = true;
    setError(undefined);
    try {
      await command.mutateAsync(reason);
      if (!command.isCurrent()) return;
      invalidateExpenseReads(client, user!.id, org);
      close();
    } catch (failure) {
      if (isAbortError(failure) || !command.isCurrent()) return;
      setError(
        failure instanceof ApiError
          ? failure.code === 'EXPENSE_ALREADY_VOIDED'
            ? 'This expense was already voided. Reload to inspect its retained evidence.'
            : failure.message
          : 'The action could not be confirmed.',
      );
      // Archive is repeat-safe; void has no receipt replay and needs a fresh version/state.
      if (
        target.kind === 'void' &&
        (!(failure instanceof ApiError) ||
          failure.kind !== 'http' ||
          (failure.status ?? 0) >= 500 ||
          failure.status === 409)
      )
        setBlocked(true);
    } finally {
      lock.current = false;
    }
  };
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="expense-action-title"
      aria-describedby="expense-action-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!command.isPending) close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (!command.isPending) close();
        }
        if (event.key !== 'Tab') return;
        const nodes = Array.from(
          dialog.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled), textarea:not(:disabled)',
          ),
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (!first) event.preventDefault();
        else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <h2 id="expense-action-title">
        {target.kind === 'archive' ? 'Archive expense category?' : 'Void expense?'}
      </h2>
      <p id="expense-action-description">
        {target.kind === 'archive'
          ? `Archive ${target.category.name}? Existing expense references remain. New assignments are blocked; no deletion or restoration is available.`
          : `Void ${target.resource.expense.description} for ${formatInvoiceMoney(target.resource.expense.amount, target.resource.expense.currency)} ${target.resource.expense.currency}? The retained record becomes immutable and is excluded from current-state expense, Cash Flow and cash-basis P&L metrics, including historical date ranges. No bank transaction is reversed.`}
      </p>
      {target.kind === 'void' && (
        <div className={styles.field}>
          <label htmlFor="expense-void-reason">Void reason</label>
          <textarea
            id="expense-void-reason"
            maxLength={500}
            value={reason}
            disabled={command.isPending || blocked}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {blocked && (
        <button
          onClick={() => {
            close();
            reload();
          }}
        >
          Reload expense before another action
        </button>
      )}
      <div className={styles.actions}>
        <button disabled={command.isPending} onClick={close}>
          Keep {target.kind === 'archive' ? 'category' : 'expense'} unchanged
        </button>
        <button
          className={styles.danger}
          disabled={command.isPending || blocked}
          onClick={() => {
            void submit();
          }}
        >
          {command.isPending
            ? 'Applying expense action…'
            : target.kind === 'archive'
              ? 'Confirm category archive'
              : 'Confirm expense void'}
        </button>
      </div>
    </dialog>
  );
}
