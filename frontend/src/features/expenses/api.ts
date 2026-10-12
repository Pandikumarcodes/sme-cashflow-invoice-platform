import type { Session } from '../../auth/session';
import {
  categoryInputSchema,
  expenseInputSchema,
  voidSchema,
  parseCategory,
  parseExpense,
  validateCategory,
  validateExpense,
  parsePage,
  invalidExpense,
  type CategoryFormValues,
  type CategoryFilters,
  type ExpenseFilters,
  type ExpenseInput,
  type ExpenseResource,
} from './contracts';
const root = (org: string) => `/organizations/${org}`;
export async function listCategories(
  session: Session,
  org: string,
  filters: CategoryFilters,
  after: string | undefined,
  signal: AbortSignal,
) {
  return parsePage(
    (
      await session.request(`${root(org)}/expense-categories`, {
        query: { ...filters, after },
        signal,
      })
    ).body,
    filters.limit,
    (row) => {
      const category = validateCategory(row, org);
      if (category.status !== filters.status) return invalidExpense();
      return category;
    },
    (row) => row.id,
  );
}
export async function saveCategory(
  session: Session,
  org: string,
  values: CategoryFormValues,
  signal: AbortSignal,
  id?: string,
) {
  const body = categoryInputSchema.parse({
    name: values.name,
    ...(values.description !== '' ? { description: values.description } : {}),
  });
  const response = await session.request(`${root(org)}/expense-categories${id ? `/${id}` : ''}`, {
    method: id ? 'PATCH' : 'POST',
    body,
    signal,
  });
  const category = parseCategory(response.body, org, id);
  if (category.status !== 'ACTIVE') return invalidExpense();
  return category;
}
export async function archiveCategory(
  session: Session,
  org: string,
  id: string,
  signal: AbortSignal,
) {
  const response = await session.request(`${root(org)}/expense-categories/${id}/archive`, {
    method: 'POST',
    body: {},
    signal,
  });
  const category = parseCategory(response.body, org, id);
  if (category.status !== 'ARCHIVED') return invalidExpense();
  return category;
}
export async function listExpenses(
  session: Session,
  org: string,
  currency: string,
  filters: ExpenseFilters,
  after: string | undefined,
  signal: AbortSignal,
) {
  const query = Object.fromEntries(
    Object.entries(filters).map(([key, value]) => [key, value === '' ? undefined : value]),
  );
  return parsePage(
    (await session.request(`${root(org)}/expenses`, { query: { ...query, after }, signal })).body,
    filters.limit,
    (row) => {
      const expense = validateExpense(row, org, currency);
      if (
        expense.status !== filters.status ||
        (filters.categoryId && expense.categoryId !== filters.categoryId) ||
        (filters.expenseDateFrom && expense.expenseDate < filters.expenseDateFrom) ||
        (filters.expenseDateTo && expense.expenseDate > filters.expenseDateTo)
      )
        return invalidExpense();
      return expense;
    },
    (row) => row.id,
  );
}
export async function getExpense(
  session: Session,
  org: string,
  currency: string,
  id: string,
  signal: AbortSignal,
) {
  const response = await session.request(`${root(org)}/expenses/${id}`, { signal });
  return parseExpense(response.body, response.headers, org, currency, id);
}
export async function saveExpense(
  session: Session,
  org: string,
  currency: string,
  values: ExpenseInput,
  signal: AbortSignal,
  resource?: ExpenseResource,
) {
  const response = await session.request(
    `${root(org)}/expenses${resource ? `/${resource.expense.id}` : ''}`,
    {
      method: resource ? 'PATCH' : 'POST',
      body: expenseInputSchema.parse(values),
      ifMatch: resource?.etag,
      signal,
    },
  );
  const result = parseExpense(response.body, response.headers, org, currency, resource?.expense.id);
  if (result.expense.status !== 'ACTIVE') return invalidExpense();
  return result;
}
export async function voidExpense(
  session: Session,
  org: string,
  currency: string,
  resource: ExpenseResource,
  reason: string,
  signal: AbortSignal,
) {
  const response = await session.request(`${root(org)}/expenses/${resource.expense.id}/void`, {
    method: 'POST',
    body: voidSchema.parse({ reason }),
    ifMatch: resource.etag,
    signal,
  });
  const result = parseExpense(response.body, response.headers, org, currency, resource.expense.id);
  if (result.expense.status !== 'VOIDED') return invalidExpense();
  return result;
}
