import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useOrganization } from '../../organizations/OrganizationContext';
import { formatInvoiceMoney } from '../invoices/calculation';
import { localToday } from '../dashboard/dates';
import { reversalSchema, type Payment, type ReversalInput } from './contracts';
import { usePaymentAttempt } from './queries';
import styles from './Payments.module.css';
export function ReversalDialog({
  payment,
  close,
  reload,
}: {
  payment: Payment;
  close: () => void;
  reload: () => void;
}) {
  const org = useOrganization().organization!;
  const dialog = useRef<HTMLDialogElement>(null);
  const command = usePaymentAttempt(org.id, org.baseCurrency, 'reverse', payment.id);
  const form = useForm<ReversalInput>({
    resolver: zodResolver(reversalSchema),
    defaultValues:
      command.attempt?.operation === 'reverse'
        ? command.attempt.body
        : { reason: '', reversalDate: localToday(org.timezone) },
  });
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
  const submit = form.handleSubmit((body) =>
    command.send({ operation: 'reverse', resourceId: payment.id, body }),
  );
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="reversal-title"
      aria-describedby="reversal-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!command.isPending && !command.uncertain) close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (!command.isPending && !command.uncertain) close();
        }
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          dialog.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]',
          ),
        ).filter((node) => !node.closest('fieldset:disabled'));
        const first = controls[0];
        const last = controls.at(-1);
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
      <h2 id="reversal-title">Reverse payment in full?</h2>
      <p id="reversal-description">
        Reverse the complete {formatInvoiceMoney(payment.amount, payment.currency)}{' '}
        {payment.currency} payment {payment.id} on invoice {payment.invoice.invoiceNumber}. Original
        facts remain; the server recalculates settlement. This does not refund money through a bank
        or gateway.
      </p>
      {command.isSuccess && command.data ? (
        <>
          <p role="status" className={styles.success}>
            Full reversal confirmed{command.data.replayed ? ' from the original receipt' : ''}.
            Remaining balance in receipt:{' '}
            {formatInvoiceMoney(command.data.payment.invoice.balanceDue, payment.currency)}.
          </p>
          <button
            onClick={() => {
              close();
              reload();
            }}
          >
            View current reversed payment
          </button>
        </>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <button type="button" disabled={command.isPending || command.uncertain} onClick={close}>
            Keep payment unchanged
          </button>
          <fieldset disabled={!!command.attempt} className={styles.panel}>
            <legend>Full reversal evidence</legend>
            <div className={styles.field}>
              <label htmlFor="reversal-reason">Reversal reason</label>
              <textarea
                id="reversal-reason"
                maxLength={500}
                {...form.register('reason')}
                aria-invalid={!!form.formState.errors.reason}
                aria-describedby={
                  form.formState.errors.reason ? 'reversal-reason-error' : undefined
                }
              />
              {form.formState.errors.reason && (
                <p role="alert" id="reversal-reason-error">
                  {form.formState.errors.reason.message}
                </p>
              )}
            </div>
            <div className={styles.field}>
              <label htmlFor="reversal-date">Reversal date</label>
              <input
                id="reversal-date"
                type="date"
                {...form.register('reversalDate')}
                aria-invalid={!!form.formState.errors.reversalDate}
                aria-describedby={
                  form.formState.errors.reversalDate ? 'reversal-date-error' : undefined
                }
              />
              {form.formState.errors.reversalDate && (
                <p role="alert" id="reversal-date-error">
                  {form.formState.errors.reversalDate.message}
                </p>
              )}
            </div>
            <small>Business date in {org.timezone}; the full amount is fixed.</small>
          </fieldset>
          {command.error && (
            <p role="alert" className={styles.error}>
              {command.error}
            </p>
          )}
          {command.uncertain && (
            <>
              <p role="alert" className={styles.warning}>
                Reversal outcome uncertain. Do not start a new reversal. The same key and unchanged
                evidence are retained in this account and organization’s runtime memory.
              </p>
              <button
                type="button"
                disabled={command.isPending}
                onClick={() => {
                  void command.send();
                }}
              >
                Retry same reversal attempt
              </button>
              <Link to={`/organizations/${org.id}/payments?invoiceId=${payment.invoiceId}`}>
                Reconcile payment history
              </Link>
            </>
          )}
          {command.blocked && (
            <button
              type="button"
              onClick={() => {
                close();
                reload();
              }}
            >
              Reload payment before another action
            </button>
          )}
          <button
            type="submit"
            className={styles.danger}
            disabled={!!command.attempt || command.isPending}
          >
            {command.isPending ? 'Reversing payment…' : 'Confirm full reversal'}
          </button>
        </form>
      )}
    </dialog>
  );
}
