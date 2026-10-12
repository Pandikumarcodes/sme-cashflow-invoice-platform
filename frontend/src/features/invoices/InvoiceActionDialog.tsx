import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, isAbortError } from '../../api/errors';
import { invalidateFinancialReads } from '../financials/query-keys';
import { reasonSchema, type InvoiceResource } from './contracts';
import { transitionInvoice, type InvoiceAction } from './api';
import { invoiceKeys, useInvoiceCommand } from './queries';
import styles from './Invoices.module.css';
const labels = {
  issue: 'Issue invoice',
  cancel: 'Cancel issued invoice',
  void: 'Void invoice',
  delete: 'Delete draft',
};
export function InvoiceActionDialog({
  resource,
  action,
  close,
  reload,
}: {
  resource: InvoiceResource;
  action: InvoiceAction;
  close: () => void;
  reload: () => void;
}) {
  const { session, user } = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [blocked, setBlocked] = useState(false);
  const invoice = resource.invoice;
  const command = useInvoiceCommand(invoice.organizationId, action, (_input: void, signal) =>
    transitionInvoice(
      session,
      invoice.organizationId,
      invoice.currency,
      resource,
      action,
      reason,
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
    if ((action === 'cancel' || action === 'void') && !reasonSchema.safeParse({ reason }).success) {
      setError('Enter a visible reason of at most 500 characters.');
      return;
    }
    lock.current = true;
    setError(undefined);
    try {
      await command.mutateAsync();
      if (!command.isCurrent()) return;
      void client.invalidateQueries({
        queryKey: invoiceKeys.scope(user!.id, invoice.organizationId),
      });
      invalidateFinancialReads(client, user!.id, invoice.organizationId, [
        'dashboard',
        'receivables-aging',
      ]);
      close();
      if (action === 'delete')
        void navigate(`/organizations/${invoice.organizationId}/invoices`, { replace: true });
    } catch (failure) {
      if (isAbortError(failure) || !command.isCurrent()) return;
      setError(
        failure instanceof ApiError
          ? failure.code === 'ACTIVE_PAYMENTS_EXIST'
            ? 'Payment history prevents this transition. Reload to inspect the current invoice.'
            : failure.message
          : 'The invoice action could not be confirmed.',
      );
      // Invoice transitions have no request-key replay contract. Re-read before a fresh action.
      if (
        !(failure instanceof ApiError) ||
        failure.kind !== 'http' ||
        (failure.status ?? 0) >= 500 ||
        failure.status === 409
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
      aria-labelledby="invoice-action-title"
      aria-describedby="invoice-action-description"
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
        const elements = dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), textarea:not(:disabled)',
        );
        const first = elements?.[0];
        const last = elements?.[elements.length - 1];
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
      <h2 id="invoice-action-title">{labels[action]}?</h2>
      <p id="invoice-action-description">
        {action === 'issue'
          ? 'Issuance allocates the official number and freezes the customer snapshot, dates, items and totals. This cannot be edited afterward.'
          : action === 'delete'
            ? 'Permanently remove this draft and its items. The audit record remains, and the organization currency stays locked.'
            : action === 'cancel'
              ? 'Retain this issued invoice as cancelled. Any payment history, including reversed payments, prevents cancellation. This cannot be reopened.'
              : 'Retain this invoice as void with a reason. Recorded payments prevent voiding. This cannot be reopened.'}
      </p>
      {(action === 'cancel' || action === 'void') && (
        <div className={styles.field}>
          <label htmlFor="invoice-action-reason">Reason</label>
          <textarea
            id="invoice-action-reason"
            value={reason}
            maxLength={500}
            disabled={command.isPending}
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
          type="button"
          onClick={() => {
            close();
            reload();
          }}
        >
          Reload invoice before another action
        </button>
      )}
      <div className={styles.actions}>
        <button type="button" disabled={command.isPending} onClick={close}>
          Keep invoice unchanged
        </button>
        <button
          type="button"
          className={action === 'issue' ? styles.primary : styles.danger}
          disabled={command.isPending || blocked}
          onClick={() => {
            void submit();
          }}
        >
          {command.isPending
            ? 'Applying invoice action…'
            : `Confirm ${labels[action].toLowerCase()}`}
        </button>
      </div>
    </dialog>
  );
}
