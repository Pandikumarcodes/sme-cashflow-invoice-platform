import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, isAbortError } from '../../api/errors';
import { archiveCustomer } from './api';
import { customerKeys, useCustomerCommand } from './queries';
import type { Customer } from './contracts';
import styles from './Customers.module.css';
export function ArchiveDialog({ customer, close }: { customer: Customer; close: () => void }) {
  const { session, user } = useAuth();
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const command = useCustomerCommand<void>(customer.organizationId, 'archive', (_input, signal) =>
    archiveCustomer(session, customer.organizationId, customer.id, signal),
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
  const archive = async () => {
    if (lock.current) return;
    lock.current = true;
    try {
      await command.mutateAsync();
      if (!command.isCurrent()) return;
      void client.invalidateQueries({
        queryKey: customerKeys.scope(user!.id, customer.organizationId),
      });
      close();
    } catch (failure) {
      if (isAbortError(failure) || !command.isCurrent()) return;
      // The mutation retains only a safe ApiError. Retrying archive is an explicit idempotent action.
    } finally {
      lock.current = false;
    }
  };
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="archive-title"
      aria-describedby="archive-description"
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
        const buttons =
          dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        const first = buttons?.[0];
        const last = buttons?.[buttons.length - 1];
        if (!first) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <h2 id="archive-title">Archive customer?</h2>
      <p id="archive-description">
        Archive {customer.displayName}? The record and existing invoice references are retained.
        This is not permanent deletion. Archived customers cannot be selected for new invoices;
        restoration is unavailable.
      </p>
      {command.isError && !isAbortError(command.error) && (
        <p role="alert" className={styles.error}>
          {command.error instanceof ApiError
            ? command.error.message
            : 'Archiving could not be confirmed. Please try again.'}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondary}
          disabled={command.isPending}
          onClick={close}
        >
          Cancel archive
        </button>
        <button
          type="button"
          className={styles.danger}
          disabled={command.isPending}
          onClick={() => {
            void archive();
          }}
        >
          {command.isPending ? 'Archiving…' : 'Confirm archive'}
        </button>
      </div>
    </dialog>
  );
}
