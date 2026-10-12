import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { useOrganization } from '../../organizations/OrganizationContext';
import { ApiError, isAbortError } from '../../api/errors';
import {
  categoryFormSchema,
  type Category,
  type CategoryFilters,
  type CategoryFormValues,
} from './contracts';
import { saveCategory } from './api';
import { useCategoryList, useExpenseCommand, invalidateExpenseReads } from './queries';
import { ExpenseBoundary, ExpenseError } from './states';
import { LifecycleDialog } from './LifecycleDialog';
import styles from './Expenses.module.css';
export function CategoriesPage() {
  const context = useOrganization();
  return (
    <ExpenseBoundary permission="expense.read">
      {context.organization && <Categories key={context.organization.id} />}
    </ExpenseBoundary>
  );
}
function Categories() {
  const context = useOrganization();
  const org = context.organization!;
  const [filters, setFilters] = useState<CategoryFilters>({ status: 'ACTIVE', limit: 25 });
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [editing, setEditing] = useState<Category | 'new'>();
  const [archiving, setArchiving] = useState<Category>();
  const list = useCategoryList(org.id, filters, cursors.at(-1));
  const reload = () => {
    setEditing(undefined);
    setArchiving(undefined);
    void list.refetch();
  };
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <Link to={`/organizations/${org.id}/expenses`}>Back to expenses</Link>
          <h1>Expense categories</h1>
          <p>
            Names are unique within this organization, including archived names. Default categories
            may be renamed or archived; their system keys stay unchanged.
          </p>
        </div>
        {context.hasPermission('expense_category.manage') && (
          <button className={styles.primary} onClick={() => setEditing('new')}>
            Add category
          </button>
        )}
      </header>
      {editing && context.hasPermission('expense_category.manage') && (
        <CategoryForm
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.updatedAt}`}
          category={editing === 'new' ? undefined : editing}
          close={() => setEditing(undefined)}
          reload={reload}
        />
      )}
      <section className={styles.panel}>
        <div className={styles.grid}>
          <div className={styles.field}>
            <label htmlFor="category-status">Category status</label>
            <select
              id="category-status"
              value={filters.status}
              onChange={(event) => {
                setFilters((old) => ({
                  ...old,
                  status: event.target.value as 'ACTIVE' | 'ARCHIVED',
                }));
                setCursors([undefined]);
                setEditing(undefined);
              }}
            >
              <option>ACTIVE</option>
              <option>ARCHIVED</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="category-page-size">Category page size</label>
            <select
              id="category-page-size"
              value={filters.limit}
              onChange={(event) => {
                setFilters((old) => ({ ...old, limit: Number(event.target.value) }));
                setCursors([undefined]);
              }}
            >
              {[25, 50, 100].map((limit) => (
                <option key={limit}>{limit}</option>
              ))}
            </select>
          </div>
        </div>
      </section>
      {list.isPending || list.isFetching ? (
        <p role="status">Loading categories…</p>
      ) : list.isError ? (
        <>
          <ExpenseError
            error={list.error}
            retry={() => {
              void list.refetch();
            }}
          />
          {list.error instanceof ApiError && list.error.code === 'INVALID_CURSOR' && (
            <button onClick={() => setCursors([undefined])}>Restart category pagination</button>
          )}
        </>
      ) : (
        <section className={styles.panel}>
          {!list.data.data.length ? (
            <p role="status">No {filters.status.toLowerCase()} expense categories on this page.</p>
          ) : (
            <table className={styles.table}>
              <caption>Expense category directory</caption>
              <thead>
                <tr>
                  {['Category', 'Description', 'Status', 'Actions'].map((label) => (
                    <th scope="col" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((category) => (
                  <tr key={category.id}>
                    <th scope="row">
                      {category.name}
                      {category.systemKey && <small> · Default category</small>}
                    </th>
                    <td data-label="Description">{category.description ?? 'Not set'}</td>
                    <td
                      data-label="Status"
                      className={category.status === 'ACTIVE' ? styles.success : styles.warning}
                    >
                      {category.status}
                    </td>
                    <td data-label="Actions">
                      {category.status === 'ACTIVE' &&
                      context.hasPermission('expense_category.manage') ? (
                        <div className={styles.actions}>
                          <button
                            aria-label={`Edit category ${category.name}`}
                            onClick={() => setEditing(category)}
                          >
                            Edit category
                          </button>
                          <button
                            aria-label={`Archive category ${category.name}`}
                            onClick={() => setArchiving(category)}
                          >
                            Archive category
                          </button>
                        </div>
                      ) : (
                        <span>Read only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <nav aria-label="Category pagination" className={styles.pagination}>
            <button
              disabled={cursors.length === 1}
              onClick={() => setCursors((old) => old.slice(0, -1))}
            >
              Previous categories
            </button>
            <span>Category page {cursors.length}</span>
            <button
              disabled={!list.data.meta.hasMore}
              onClick={() => {
                if (list.data.meta.nextCursor)
                  setCursors((old) => [...old, list.data.meta.nextCursor!]);
              }}
            >
              Next categories
            </button>
          </nav>
        </section>
      )}
      {archiving && context.hasPermission('expense_category.manage') && (
        <LifecycleDialog
          target={{ kind: 'archive', category: archiving }}
          close={() => setArchiving(undefined)}
          reload={reload}
        />
      )}
    </div>
  );
}
function CategoryForm({
  category,
  close,
  reload,
}: {
  category?: Category;
  close: () => void;
  reload: () => void;
}) {
  const org = useOrganization().organization!;
  const { session, user } = useAuth();
  const client = useQueryClient();
  const lock = useRef(false);
  const [error, setError] = useState<string>();
  const [blocked, setBlocked] = useState(false);
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema(category)),
    defaultValues: { name: category?.name ?? '', description: category?.description ?? '' },
  });
  const command = useExpenseCommand(
    org.id,
    category ? 'category.update' : 'category.create',
    (values: CategoryFormValues, signal) =>
      saveCategory(session, org.id, values, signal, category?.id),
  );
  const submit = async (values: CategoryFormValues) => {
    if (lock.current || blocked) return;
    lock.current = true;
    setError(undefined);
    try {
      await command.mutateAsync(values);
      if (!command.isCurrent()) return;
      invalidateExpenseReads(client, user!.id, org.id);
      close();
    } catch (failure) {
      if (isAbortError(failure) || !command.isCurrent()) return;
      if (failure instanceof ApiError) {
        if (failure.code === 'EXPENSE_CATEGORY_ALREADY_EXISTS')
          form.setError('name', {
            message: 'This name is already reserved, including archived categories.',
          });
        for (const field of failure.fields)
          if (field.field === 'name' || field.field === 'description')
            form.setError(field.field, { message: field.message });
        const unknown = failure.kind !== 'http' || (failure.status ?? 0) >= 500;
        if (unknown || failure.code === 'EXPENSE_CATEGORY_NOT_EDITABLE') setBlocked(true);
        setError(
          unknown
            ? 'The save outcome is uncertain. Inspect current category records before another submission.'
            : failure.message,
        );
      } else {
        setBlocked(true);
        setError('Category saving could not be confirmed. Reload current categories.');
      }
    } finally {
      lock.current = false;
    }
  };
  return (
    <section className={styles.panel}>
      <h2>{category ? 'Edit expense category' : 'Create expense category'}</h2>
      <p>
        Only name and description are writable. Names trim and collapse whitespace. Existing
        descriptions cannot be cleared.
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {blocked && (
        <button onClick={reload}>Reload category records before another submission</button>
      )}
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(submit)(event);
        }}
      >
        <div className={styles.grid}>
          {(['name', 'description'] as const).map((field) => (
            <div className={styles.field} key={field}>
              <label htmlFor={`category-${field}`}>Category {field}</label>
              <input
                id={`category-${field}`}
                maxLength={field === 'description' ? 500 : undefined}
                {...form.register(field)}
                disabled={command.isPending || blocked}
                aria-invalid={!!form.formState.errors[field]}
                aria-describedby={
                  form.formState.errors[field] ? `category-error-${field}` : undefined
                }
              />
              {form.formState.errors[field] && (
                <p role="alert" id={`category-error-${field}`}>
                  {form.formState.errors[field]?.message}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className={styles.actions}>
          <button type="button" disabled={command.isPending} onClick={close}>
            Cancel category editing
          </button>
          <button className={styles.primary} disabled={command.isPending || blocked}>
            {command.isPending
              ? 'Saving category…'
              : category
                ? 'Save category'
                : 'Create category'}
          </button>
        </div>
      </form>
    </section>
  );
}
