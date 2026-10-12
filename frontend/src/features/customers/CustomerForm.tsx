import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, isAbortError } from '../../api/errors';
import { customerFormSchema, type CustomerFormValues, type CustomerResource } from './contracts';
import { createCustomer, updateCustomer } from './api';
import { customerKeys, useCustomerCommand } from './queries';
import styles from './Customers.module.css';
export function CustomerForm({
  organizationId,
  resource,
  reload,
}: {
  organizationId: string;
  resource?: CustomerResource;
  reload?: () => void;
}) {
  const { session, user } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: {
      displayName: resource?.customer.displayName ?? '',
      customerCode: resource?.customer.customerCode ?? '',
      email: resource?.customer.email ?? '',
    },
  });
  const [error, setError] = useState<string>();
  const [blocked, setBlocked] = useState(false);
  const submitting = useRef(false);
  const command = useCustomerCommand<CustomerFormValues>(
    organizationId,
    resource ? 'update' : 'create',
    (values, signal) =>
      resource
        ? updateCustomer(
            session,
            organizationId,
            resource.customer.id,
            resource.etag,
            values,
            signal,
          )
        : createCustomer(session, organizationId, values, signal),
  );
  const listPath = `/organizations/${organizationId}/customers`;
  const submit = async (values: CustomerFormValues) => {
    if (submitting.current || blocked) return;
    submitting.current = true;
    setError(undefined);
    try {
      const result = await command.mutateAsync(values);
      if (!command.isCurrent()) return;
      void client.invalidateQueries({ queryKey: customerKeys.scope(user!.id, organizationId) });
      void navigate(`${listPath}/${result.customer.id}`, { replace: true });
    } catch (failure) {
      if (isAbortError(failure) || !command.isCurrent()) return;
      if (failure instanceof ApiError) {
        if (failure.code === 'CUSTOMER_CODE_UNAVAILABLE')
          form.setError('customerCode', { message: 'This customer code is already in use.' });
        for (const field of failure.fields)
          if (
            field.field === 'displayName' ||
            field.field === 'customerCode' ||
            field.field === 'email'
          )
            form.setError(field.field, { message: field.message });
        if (failure.code === 'CONCURRENT_MODIFICATION') {
          setBlocked(true);
          setError(
            'This customer changed while you were editing. Reload the current record before saving again.',
          );
        } else if (
          failure.kind === 'network' ||
          failure.kind === 'invalid-response' ||
          (failure.status ?? 0) >= 500
        ) {
          setBlocked(true);
          setError(
            resource
              ? 'The update outcome is uncertain. Reload the current record before another submission.'
              : 'Creation may have completed. Check the customer list before creating this customer again.',
          );
        } else
          setError(
            failure.code === 'CUSTOMER_CODE_UNAVAILABLE'
              ? 'Choose another customer code.'
              : failure.message,
          );
      } else setError('The customer could not be saved. Please try again.');
    } finally {
      submitting.current = false;
    }
  };
  return (
    <section className={styles.panel}>
      <h1>{resource ? 'Edit customer' : 'Add customer'}</h1>
      <p>
        Enter the customer name and optional code and email. No address or financial history is
        stored here.
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {blocked &&
        (resource ? (
          <button type="button" className={styles.secondary} onClick={reload}>
            Reload current record (discard draft)
          </button>
        ) : (
          <Link to={listPath}>Check customer list</Link>
        ))}
      <form
        onSubmit={(event) => {
          void form.handleSubmit(submit)(event);
        }}
        noValidate
        aria-label={resource ? 'Edit customer' : 'Add customer'}
        className={styles.form}
      >
        {(
          [
            ['displayName', 'Display name', 'organization'],
            ['customerCode', 'Customer code', 'off'],
            ['email', 'Email address', 'email'],
          ] as const
        ).map(([field, label, autoComplete]) => (
          <div key={field} className={styles.field}>
            <label htmlFor={`customer-${field}`}>
              {label}
              {field !== 'displayName' && ' (optional)'}
            </label>
            <input
              {...form.register(field)}
              id={`customer-${field}`}
              type={field === 'email' ? 'email' : 'text'}
              autoComplete={autoComplete}
              aria-invalid={!!form.formState.errors[field]}
              aria-describedby={
                form.formState.errors[field] ? `customer-${field}-error` : undefined
              }
              disabled={command.isPending}
            />
            {form.formState.errors[field] && (
              <p id={`customer-${field}-error`} className={styles.error}>
                {form.formState.errors[field]?.message}
              </p>
            )}
          </div>
        ))}
        <div className={styles.actions}>
          <button
            className={styles.primary}
            disabled={command.isPending || form.formState.isSubmitting || blocked}
          >
            {command.isPending ? 'Saving…' : resource ? 'Save changes' : 'Create customer'}
          </button>
          <Link to={resource ? `${listPath}/${resource.customer.id}` : listPath}>Cancel</Link>
        </div>
      </form>
    </section>
  );
}
