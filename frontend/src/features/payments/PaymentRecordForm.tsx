import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useOrganization } from '../../organizations/OrganizationContext';
import { ApiError } from '../../api/errors';
import { useInvoiceDetail, useInvoiceList } from '../invoices/queries';
import { defaultFilters } from '../invoices/contracts';
import { formatInvoiceMoney, InvoiceDecimal } from '../invoices/calculation';
import { localToday } from '../dashboard/dates';
import { methods, recordFormSchema, type RecordInput } from './contracts';
import { usePaymentAttempt } from './queries';
import styles from './Payments.module.css';

export function EligibleInvoices({ choose }: { choose: (id: string) => void }) {
  const org = useOrganization().organization!;
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const valid = search === '' || (search.length >= 2 && search.length <= 100 && /\S/.test(search));
  useEffect(() => {
    if (!valid || search === debounced) return;
    const timer = window.setTimeout(() => {
      setDebounced(search);
      setCursors([undefined]);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, debounced, valid]);
  const query = useInvoiceList(
    org.id,
    org.baseCurrency,
    { ...defaultFilters, status: 'ISSUED', search: debounced },
    cursors.at(-1),
    valid && search === debounced,
  );
  const rows = query.data?.data.filter(
    (invoice) => invoice.status === 'ISSUED' && new InvoiceDecimal(invoice.balanceDue).gt('0'),
  );
  return (
    <section className={styles.panel}>
      <h2>Select an issued invoice</h2>
      <div className={styles.field}>
        <label htmlFor="payment-invoice-search">Search eligible invoices</label>
        <input
          id="payment-invoice-search"
          type="search"
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
        <small>Invoice number or customer name; 2–100 characters.</small>
      </div>
      {!valid ? (
        <p role="status">Enter 2–100 visible search characters.</p>
      ) : search !== debounced || query.isPending || query.isFetching ? (
        <p role="status">Loading eligible invoices…</p>
      ) : query.isError ? (
        <>
          <p role="alert">
            {query.error instanceof ApiError ? query.error.message : 'Invoices unavailable.'}
          </p>
          <button
            onClick={() => {
              if (query.error instanceof ApiError && query.error.code === 'INVALID_CURSOR')
                setCursors([undefined]);
              else void query.refetch();
            }}
          >
            Retry invoice selection
          </button>
        </>
      ) : (
        <>
          <div className={styles.field}>
            <label htmlFor="payment-invoice">Invoice to settle</label>
            <select
              id="payment-invoice"
              value=""
              onChange={(event) => {
                if (event.target.value) choose(event.target.value);
              }}
            >
              <option value="">Choose an invoice</option>
              {rows?.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.invoiceNumber} · {invoice.customer.displayName} ·{' '}
                  {formatInvoiceMoney(invoice.balanceDue, invoice.currency)} remaining
                </option>
              ))}
            </select>
          </div>
          {!rows?.length && (
            <p role="status">No eligible invoices on this page. Try another page or search.</p>
          )}
          <nav className={styles.pagination} aria-label="Eligible invoice pagination">
            <button
              disabled={cursors.length === 1}
              onClick={() => setCursors((old) => old.slice(0, -1))}
            >
              Previous eligible invoices
            </button>
            <span>Page {cursors.length}</span>
            <button
              disabled={!query.data?.meta.hasMore}
              onClick={() => {
                if (query.data?.meta.nextCursor)
                  setCursors((old) => [...old, query.data!.meta.nextCursor!]);
              }}
            >
              Next eligible invoices
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
export function SelectedPaymentInvoice({
  id,
  chooseAgain,
}: {
  id: string;
  chooseAgain: () => void;
}) {
  const org = useOrganization().organization!;
  const [revision, setRevision] = useState(0);
  const invoice = useInvoiceDetail(org.id, org.baseCurrency, id);
  if (invoice.isPending) return <p role="status">Checking invoice settlement…</p>;
  if (invoice.isError)
    return (
      <section className={styles.panel}>
        <p role="alert">
          {invoice.error instanceof ApiError ? invoice.error.message : 'Invoice unavailable.'}
        </p>
        <button
          onClick={() => {
            void invoice.refetch();
          }}
        >
          Reload selected invoice
        </button>
        <button onClick={chooseAgain}>Choose another invoice</button>
      </section>
    );
  const value = invoice.data.invoice;
  return (
    <PaymentRecordForm
      key={`${id}:${revision}`}
      invoice={value}
      refreshing={invoice.isFetching}
      chooseAgain={chooseAgain}
      reload={() => {
        setRevision((old) => old + 1);
        void invoice.refetch();
      }}
    />
  );
}
function PaymentRecordForm({
  invoice,
  refreshing,
  chooseAgain,
  reload,
}: {
  invoice: NonNullable<ReturnType<typeof useInvoiceDetail>['data']>['invoice'];
  refreshing: boolean;
  chooseAgain: () => void;
  reload: () => void;
}) {
  const org = useOrganization().organization!;
  const command = usePaymentAttempt(org.id, org.baseCurrency, 'record', invoice.id);
  const form = useForm<RecordInput>({
    resolver: zodResolver(recordFormSchema(invoice.currency, invoice.balanceDue)),
    defaultValues:
      command.attempt?.operation === 'record'
        ? command.attempt.body
        : { amount: '', paymentDate: localToday(org.timezone), method: 'BANK_TRANSFER' },
  });
  const payments = `/organizations/${org.id}/payments`;
  if (command.isSuccess && command.data)
    return (
      <section className={styles.panel}>
        <h2>Payment recording confirmed</h2>
        <p role="status" className={styles.success}>
          {command.data.replayed
            ? 'The original recording receipt was recovered. No second payment was created.'
            : 'The server confirmed this payment.'}
        </p>
        <p>
          {formatInvoiceMoney(command.data.payment.amount, invoice.currency)} {invoice.currency} ·{' '}
          {command.data.payment.paymentDate}
        </p>
        <p>
          Receipt settlement: {command.data.payment.invoice.paymentState}; remaining{' '}
          {formatInvoiceMoney(command.data.payment.invoice.balanceDue, invoice.currency)}. A
          replayed receipt reflects the original transaction; open current details to check later
          changes.
        </p>
        <Link to={`${payments}/${command.data.payment.id}`}>View current payment details</Link>
      </section>
    );
  if (refreshing) return <p role="status">Checking invoice settlement…</p>;
  if (
    !command.attempt &&
    (invoice.status !== 'ISSUED' || !new InvoiceDecimal(invoice.balanceDue).gt('0'))
  )
    return (
      <section className={styles.panel}>
        <p role="alert">This invoice is not eligible for recording a payment.</p>
        <button onClick={chooseAgain}>Choose another invoice</button>
      </section>
    );
  return (
    <section className={styles.panel}>
      <h2>Record payment for {invoice.invoiceNumber}</h2>
      <p>
        Current server balance: {formatInvoiceMoney(invoice.balanceDue, invoice.currency)}{' '}
        {invoice.currency}. The server checks the balance again under its settlement lock.
      </p>
      <p>
        Business dates use {org.timezone}. A partial payment is permitted; overpayment is rejected.
      </p>
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit((body) =>
            command.send({ operation: 'record', resourceId: invoice.id, body }),
          )(event);
        }}
      >
        <fieldset disabled={!!command.attempt || command.isPending} className={styles.panel}>
          <legend>Payment inputs</legend>
          <div className={styles.grid}>
            <div className={styles.field}>
              <label htmlFor="payment-amount">Payment amount ({invoice.currency})</label>
              <input
                id="payment-amount"
                inputMode="decimal"
                {...form.register('amount')}
                aria-invalid={!!form.formState.errors.amount}
                aria-describedby={form.formState.errors.amount ? 'payment-amount-error' : undefined}
              />
              {form.formState.errors.amount && (
                <p id="payment-amount-error" role="alert">
                  {form.formState.errors.amount.message}
                </p>
              )}
            </div>
            <div className={styles.field}>
              <label htmlFor="payment-date">Payment date</label>
              <input
                id="payment-date"
                type="date"
                {...form.register('paymentDate')}
                aria-invalid={!!form.formState.errors.paymentDate}
                aria-describedby={
                  form.formState.errors.paymentDate ? 'payment-date-error' : undefined
                }
              />
              {form.formState.errors.paymentDate && (
                <p id="payment-date-error" role="alert">
                  {form.formState.errors.paymentDate.message}
                </p>
              )}
            </div>
            <div className={styles.field}>
              <label htmlFor="payment-method">Payment method</label>
              <select id="payment-method" {...form.register('method')}>
                {methods.map((method) => (
                  <option key={method}>{method}</option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>
        {command.error && (
          <p role="alert" className={styles.error}>
            {command.error}
          </p>
        )}
        {command.uncertain && (
          <div className={styles.panel}>
            <p role="alert" className={styles.warning}>
              Outcome uncertain. A timeout does not prove failure. Inputs are frozen. Check payment
              history before starting another payment. This attempt is retained in memory for this
              account and organization; a browser reload discards it.
            </p>
            <button
              type="button"
              disabled={command.isPending}
              onClick={() => {
                void command.send();
              }}
            >
              Retry same payment attempt
            </button>
            <Link to={`${payments}?invoiceId=${invoice.id}`}>
              Reconcile invoice payment history
            </Link>
          </div>
        )}
        {command.blocked && (
          <button type="button" onClick={reload}>
            Reload invoice before a new attempt
          </button>
        )}
        <div className={styles.actions}>
          <button type="button" disabled={!!command.attempt} onClick={chooseAgain}>
            Choose another invoice
          </button>
          <button
            type="submit"
            className={styles.primary}
            disabled={!!command.attempt || command.isPending}
          >
            {command.isPending ? 'Recording payment…' : 'Record payment'}
          </button>
          <Link to={`/organizations/${org.id}/invoices/${invoice.id}`}>View invoice</Link>
        </div>
      </form>
    </section>
  );
}
