import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { useOrganization } from '../../organizations/OrganizationContext';
import { ApiError, isAbortError } from '../../api/errors';
import { localToday } from '../dashboard/dates';
import {
  expenseFormSchema,
  expensePayload,
  type ExpenseFormValues,
  type ExpenseResource,
} from './contracts';
import { saveExpense } from './api';
import { invalidateExpenseReads, useExpenseCommand } from './queries';
import { CategoryPicker } from './CategoryPicker';
import styles from './Expenses.module.css';
export function ExpenseForm({
  resource,
  reload,
}: {
  resource?: ExpenseResource;
  reload?: () => void;
}) {
  const org = useOrganization().organization!;
  const { session, user } = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();
  const lock = useRef(false);
  const [error, setError] = useState<string>();
  const [blocked, setBlocked] = useState(false);
  const e = resource?.expense;
  const base = `/organizations/${org.id}/expenses`;
  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema(org.baseCurrency)),
    defaultValues: {
      categoryId: e?.categoryId ?? '',
      amount: e?.amount ?? '',
      expenseDate: e?.expenseDate ?? localToday(org.timezone),
      description: e?.description ?? '',
      vendorPayee: e?.vendorPayee ?? '',
      reference: e?.reference ?? '',
      notes: e?.notes ?? '',
    },
  });
  const command = useExpenseCommand(
    org.id,
    e ? 'update' : 'create',
    (values: ExpenseFormValues, signal) =>
      saveExpense(session, org.id, org.baseCurrency, expensePayload(values), signal, resource),
  );
  const submit = async (values: ExpenseFormValues) => {
    if (lock.current || blocked) return;
    lock.current = true;
    setError(undefined);
    try {
      const result = await command.mutateAsync(values);
      if (!command.isCurrent()) return;
      invalidateExpenseReads(client, user!.id, org.id);
      void navigate(`${base}/${result.expense.id}`, { replace: true });
    } catch (failure) {
      if (isAbortError(failure) || !command.isCurrent()) return;
      if (failure instanceof ApiError) {
        for (const field of failure.fields)
          if (
            [
              'categoryId',
              'amount',
              'expenseDate',
              'description',
              'vendorPayee',
              'reference',
              'notes',
            ].includes(field.field)
          )
            form.setError(field.field as keyof ExpenseFormValues, { message: field.message });
        if (failure.code === 'EXPENSE_CATEGORY_INACTIVE')
          form.setError('categoryId', {
            message: 'This category was archived. Choose an active category.',
          });
        if (failure.status === 409 && failure.code !== 'EXPENSE_CATEGORY_INACTIVE') {
          setBlocked(true);
          setError(
            failure.code === 'EXPENSE_NOT_EDITABLE'
              ? 'This expense is now voided and cannot be edited. Reload its current details.'
              : 'This record or category changed. Reload before another submission.',
          );
        } else if (failure.kind !== 'http' || (failure.status ?? 0) >= 500) {
          setBlocked(true);
          setError(
            e
              ? 'The update outcome is uncertain. Reload current details before another submission.'
              : 'Creation may have completed. Check the expense list before recording this expense again.',
          );
        } else setError(failure.message);
      } else {
        setBlocked(true);
        setError(
          'The expense outcome could not be confirmed. Check authoritative records before another submission.',
        );
      }
    } finally {
      lock.current = false;
    }
  };
  return (
    <section className={styles.panel}>
      <Link to={base}>Back to expenses</Link>
      <h1>{e ? 'Edit expense' : 'Record expense'}</h1>
      <p>
        Record cash already paid in {org.baseCurrency}. Business dates use {org.timezone}. The
        server owns currency, actors, timestamps and financial reports. The first expense
        permanently locks the organization currency.
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {blocked &&
        (e ? (
          <button type="button" onClick={reload}>
            Reload expense (discard edits)
          </button>
        ) : (
          <Link to={base}>Check expense list before another submission</Link>
        ))}
      <form
        noValidate
        aria-label={e ? 'Edit expense' : 'Record expense'}
        onSubmit={(event) => {
          void form.handleSubmit(submit)(event);
        }}
      >
        <Controller
          name="categoryId"
          control={form.control}
          render={({ field }) => (
            <CategoryPicker
              org={org.id}
              value={field.value}
              onChange={field.onChange}
              disabled={command.isPending || blocked}
              existing={e?.category}
              invalid={!!form.formState.errors.categoryId}
            />
          )}
        />
        {form.formState.errors.categoryId && (
          <p id="expense-category-error" role="alert">
            {form.formState.errors.categoryId.message}
          </p>
        )}
        <div className={styles.grid}>
          {(
            [
              ['amount', `Expense amount (${org.baseCurrency})`, undefined],
              ['expenseDate', 'Expense date', undefined],
              ['description', 'Expense description', 500],
              ['vendorPayee', 'Vendor / payee (optional)', 200],
              ['reference', 'Expense reference (optional)', 150],
              ['notes', 'Expense notes (optional)', 1000],
            ] as const
          ).map(([field, label, maximum]) => (
            <div key={field} className={styles.field}>
              <label htmlFor={`expense-${field}`}>{label}</label>
              {field === 'notes' ? (
                <textarea
                  id={`expense-${field}`}
                  maxLength={maximum}
                  {...form.register(field)}
                  disabled={command.isPending || blocked}
                  aria-invalid={!!form.formState.errors[field]}
                  aria-describedby={form.formState.errors[field] ? `error-${field}` : undefined}
                />
              ) : (
                <input
                  id={`expense-${field}`}
                  type={field === 'expenseDate' ? 'date' : 'text'}
                  inputMode={field === 'amount' ? 'decimal' : undefined}
                  maxLength={maximum}
                  {...form.register(field)}
                  disabled={command.isPending || blocked}
                  aria-invalid={!!form.formState.errors[field]}
                  aria-describedby={form.formState.errors[field] ? `error-${field}` : undefined}
                />
              )}{' '}
              {form.formState.errors[field] && (
                <p id={`error-${field}`} role="alert">
                  {form.formState.errors[field]?.message}
                </p>
              )}
            </div>
          ))}
        </div>
        <p>
          Blank vendor, reference or notes clear those optional fields. No receipt upload or
          scheduling is supported.
        </p>
        <button className={styles.primary} disabled={command.isPending || blocked}>
          {command.isPending ? 'Saving expense…' : e ? 'Save expense' : 'Record expense'}
        </button>
      </form>
    </section>
  );
}
