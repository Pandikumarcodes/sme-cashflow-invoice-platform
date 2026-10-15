import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Controller, useFieldArray, useForm, useWatch, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, isAbortError } from '../../api/errors';
import { useOrganization } from '../../organizations/OrganizationContext';
import { invoiceFormSchema, type InvoiceInput, type InvoiceResource } from './contracts';
import { previewInvoice, formatInvoiceMoney } from './calculation';
import { saveInvoice } from './api';
import { invoiceKeys, useInvoiceCommand } from './queries';
import { CustomerPicker } from './CustomerPicker';
import styles from './Invoices.module.css';
const emptyItem = () => ({ description: '', quantity: '1', unitPrice: '0', sortOrder: 0 });
export function InvoiceForm({
  resource,
  reload,
}: {
  resource?: InvoiceResource;
  reload?: () => void;
}) {
  const context = useOrganization();
  const organization = context.organization!;
  const currency = resource?.invoice.currency ?? organization.baseCurrency;
  const { session, user } = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();
  const lock = useRef(false);
  const [error, setError] = useState<string>();
  const [blocked, setBlocked] = useState(false);
  const form = useForm<InvoiceInput>({
    resolver: zodResolver(invoiceFormSchema(currency)),
    defaultValues: resource
      ? {
          customerId: resource.invoice.customerId,
          issueDate: resource.invoice.issueDate,
          dueDate: resource.invoice.dueDate,
          discount: resource.invoice.discount,
          taxRate: resource.invoice.taxRate,
          items: resource.invoice.items.map(({ description, quantity, unitPrice }, sortOrder) => ({
            description,
            quantity,
            unitPrice,
            sortOrder,
          })),
        }
      : {
          customerId: '',
          issueDate: '',
          dueDate: '',
          discount: { type: 'NONE', value: '0' },
          taxRate: '0',
          items: [emptyItem()],
        },
  });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const watched = useWatch({ control: form.control });
  const values = {
    ...watched,
    items: watched.items?.map((item, index) => ({ ...item, sortOrder: index })),
  };
  let preview: ReturnType<typeof previewInvoice> | undefined;
  const previewInput = invoiceFormSchema(currency).safeParse(values);
  if (previewInput.success) preview = previewInvoice(previewInput.data, currency);
  const command = useInvoiceCommand(
    organization.id,
    resource ? 'update' : 'create',
    (input: InvoiceInput, signal) =>
      saveInvoice(session, organization.id, currency, input, signal, resource),
  );
  const base = `/organizations/${organization.id}/invoices`;
  const submit = async (input: InvoiceInput) => {
    if (lock.current || blocked) return;
    lock.current = true;
    setError(undefined);
    try {
      const result = await command.mutateAsync({
        ...input,
        items: input.items.map((item, sortOrder) => ({ ...item, sortOrder })),
      });
      if (!command.isCurrent()) return;
      void client.invalidateQueries({ queryKey: invoiceKeys.scope(user!.id, organization.id) });
      void navigate(`${base}/${result.invoice.id}`, { replace: true });
    } catch (failure) {
      if (isAbortError(failure) || !command.isCurrent()) return;
      if (failure instanceof ApiError) {
        for (const field of failure.fields)
          if (
            /^(customerId|issueDate|dueDate|taxRate|discount\.(type|value)|items\.\d+\.(description|quantity|unitPrice|sortOrder))$/.test(
              field.field,
            )
          )
            form.setError(field.field as FieldPath<InvoiceInput>, { message: field.message });
        if (failure.code === 'CONCURRENT_MODIFICATION' || failure.code === 'INVOICE_FINALIZED') {
          setBlocked(true);
          setError(
            'This invoice changed or was finalized. Reload the current record before saving.',
          );
        } else if (failure.kind !== 'http' || (failure.status ?? 0) >= 500) {
          setBlocked(true);
          setError(
            resource
              ? 'The save outcome is uncertain. Reload the invoice before submitting again.'
              : 'Creation may have completed. Check the invoice list before creating another draft.',
          );
        } else setError(failure.message);
      } else setError('The invoice could not be saved. Check your input.');
    } finally {
      lock.current = false;
    }
  };
  return (
    <section className={styles.panel}>
      <h1>{resource ? 'Edit draft invoice' : 'Create invoice'}</h1>
      <p>Save a draft, then review it before issuance.</p>
      <p>
        Currency: <strong>{currency}</strong> · Set by the organization. The first invoice
        permanently locks its base currency.
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {blocked &&
        (resource ? (
          <button type="button" onClick={reload}>
            Reload invoice (discard draft)
          </button>
        ) : (
          <Link to={base}>Check invoice list</Link>
        ))}
      <form
        noValidate
        aria-label="Invoice editor"
        onSubmit={(event) => {
          void form.handleSubmit(submit)(event);
        }}
        className={styles.form}
      >
        <Controller
          control={form.control}
          name="customerId"
          render={({ field }) => (
            <CustomerPicker
              organizationId={organization.id}
              value={field.value}
              label={resource?.invoice.customer.displayName}
              onChange={field.onChange}
              disabled={command.isPending}
              invalid={!!form.formState.errors.customerId}
              describedBy={form.formState.errors.customerId ? 'invoice-customer-error' : undefined}
            />
          )}
        />
        {form.formState.errors.customerId && (
          <p id="invoice-customer-error" className={styles.error}>
            Select a valid customer.
          </p>
        )}
        <div className={styles.grid}>
          {(['issueDate', 'dueDate', 'taxRate'] as const).map((field) => (
            <div className={styles.field} key={field}>
              <label htmlFor={`invoice-${field}`}>
                {field === 'issueDate'
                  ? 'Invoice date'
                  : field === 'dueDate'
                    ? 'Due date'
                    : 'Tax rate (%)'}
              </label>
              <input
                id={`invoice-${field}`}
                type={field === 'taxRate' ? 'text' : 'date'}
                inputMode={field === 'taxRate' ? 'decimal' : undefined}
                {...form.register(field)}
                disabled={command.isPending}
                aria-invalid={!!form.formState.errors[field]}
                aria-describedby={form.formState.errors[field] ? `${field}-error` : undefined}
              />
              {form.formState.errors[field] && (
                <p className={styles.error} id={`${field}-error`}>
                  {form.formState.errors[field]?.message}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className={styles.grid}>
          <div className={styles.field}>
            <label htmlFor="discount-type">Discount type</label>
            <select
              id="discount-type"
              {...form.register('discount.type')}
              disabled={command.isPending}
            >
              <option value="NONE">None</option>
              <option value="FIXED">Fixed amount</option>
              <option value="PERCENTAGE">Percentage</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="discount-value">Discount value</label>
            <input
              id="discount-value"
              inputMode="decimal"
              {...form.register('discount.value')}
              disabled={command.isPending}
              aria-invalid={!!form.formState.errors.discount?.value}
              aria-describedby={
                form.formState.errors.discount?.value ? 'discount-value-error' : undefined
              }
            />
            {form.formState.errors.discount?.value && (
              <p className={styles.error} id="discount-value-error" role="alert">
                {form.formState.errors.discount.value.message}
              </p>
            )}
          </div>
        </div>
        <section aria-label="Invoice line items">
          <h2>Line items</h2>
          {items.fields.map((item, index) => (
            <fieldset key={item.id} className={styles.item} disabled={command.isPending}>
              <legend>Item {index + 1}</legend>
              <div className={styles.grid}>
                {(['description', 'quantity', 'unitPrice'] as const).map((field) => (
                  <div className={styles.field} key={field}>
                    <label htmlFor={`item-${item.id}-${field}`}>
                      {field === 'unitPrice'
                        ? 'Unit price'
                        : field === 'quantity'
                          ? 'Quantity'
                          : 'Description'}{' '}
                      {index + 1}
                    </label>
                    <input
                      id={`item-${item.id}-${field}`}
                      {...form.register(`items.${index}.${field}`)}
                      inputMode={field === 'description' ? undefined : 'decimal'}
                      aria-invalid={!!form.formState.errors.items?.[index]?.[field]}
                      aria-describedby={
                        form.formState.errors.items?.[index]?.[field]
                          ? `item-error-${item.id}-${field}`
                          : undefined
                      }
                    />
                    {form.formState.errors.items?.[index]?.[field] && (
                      <p className={styles.error} id={`item-error-${item.id}-${field}`}>
                        {form.formState.errors.items[index]?.[field]?.message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {preview && (
                <p>Line preview: {formatInvoiceMoney(preview.lines[index]!, currency)}</p>
              )}
              <button
                type="button"
                onClick={() => {
                  items.remove(index);
                  form
                    .getValues('items')
                    .forEach((_value, position) =>
                      form.setValue(`items.${position}.sortOrder`, position),
                    );
                }}
              >
                Remove item {index + 1}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            disabled={command.isPending || items.fields.length >= 1000}
            onClick={() => items.append({ ...emptyItem(), sortOrder: items.fields.length })}
          >
            Add item
          </button>
          {form.formState.errors.items && (
            <p role="alert" className={styles.error}>
              {form.formState.errors.items.message ??
                form.formState.errors.items.root?.message ??
                'Check line items, discount and tax.'}
            </p>
          )}
        </section>
        <section className={styles.preview} aria-label="Informational invoice preview">
          <h2>Preview</h2>
          <p>Informational only. The server calculates and stores official totals.</p>
          {preview ? (
            <dl className={styles.details}>
              {(['subtotal', 'discountTotal', 'taxableTotal', 'taxTotal', 'total'] as const).map(
                (field) => (
                  <div key={field}>
                    <dt>{field}</dt>
                    <dd>{formatInvoiceMoney(preview[field], currency)}</dd>
                  </div>
                ),
              )}
            </dl>
          ) : (
            <p>Complete valid customer, date and line-item inputs to see a preview.</p>
          )}
        </section>
        <div className={styles.actions}>
          <button
            className={styles.primary}
            disabled={command.isPending || form.formState.isSubmitting || blocked}
          >
            {command.isPending
              ? 'Saving invoice…'
              : resource
                ? 'Save draft changes'
                : 'Create draft'}
          </button>
          <Link to={resource ? `${base}/${resource.invoice.id}` : base}>Cancel</Link>
        </div>
      </form>
    </section>
  );
}
