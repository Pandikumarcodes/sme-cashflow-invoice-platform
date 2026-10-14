import { StrictMode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, afterEach, expect, it } from 'vitest';
import './ExpensePages';
import './CategoriesPage';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../../auth/AuthProvider';
import { createSession } from '../../auth/session';
import { createQueryClient } from '../../app/query-client';
import { routes } from '../../routes/routes';
import { server } from '../../test/server';
import { routerReady } from '../../test/router-ready';
import {
  apiRoot,
  authHandlers,
  authFailure,
  deferred as makeDeferred,
  testUser,
  tokenResponse,
} from '../../test/auth-fixtures';
import { dashboardOrg as a, secondOrg } from '../dashboard/test-fixtures';
import { localToday } from '../dashboard/dates';
import { organizationKeys } from '../../organizations/query-keys';
import type { Organization } from '../../organizations/contracts';
import { expenseKeys, categoryKeys } from './queries';
import {
  categoryFixture,
  expenseFixture,
  voidedFixture,
  categoryId,
  expenseId,
} from './test-fixtures';
import type { Expense, Category } from './contracts';
const b = { ...secondOrg, membership: { ...secondOrg.membership, role: 'OWNER' } };
const root = `${apiRoot}/organizations/:org/expenses`;
const categories = `${apiRoot}/organizations/:org/expense-categories`;
const path = (suffix = '', org = a.id) => `/organizations/${org}/expenses${suffix}`;
const categoryPath = (org = a.id) => `/organizations/${org}/expense-categories`;
let expense: Expense;
let category: Category;
let reads: URL[];
let categoryReads: URL[];
const disposers: (() => void)[] = [];
const gates: (() => void)[] = [];
const dialogDescriptors = ['showModal', 'close'].map(
  (name) => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)] as const,
);
function deferred() {
  const result = makeDeferred();
  gates.push(result.resolve);
  return result;
}
function page(request: Request, data: unknown[], cursor: string | null = null) {
  return HttpResponse.json({
    data,
    meta: {
      limit: Number(new URL(request.url).searchParams.get('limit') ?? 25),
      hasMore: cursor !== null,
      nextCursor: cursor,
    },
  });
}
function resource(data = expense) {
  return HttpResponse.json({ data }, { headers: { ETag: `"${data.version}"` } });
}
function mount(route = path()) {
  const query = createQueryClient();
  const session = createSession(query, apiRoot);
  const router = createMemoryRouter(routes, { initialEntries: [route] });
  render(
    <StrictMode>
      <QueryClientProvider client={query}>
        <AuthProvider session={session}>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
  disposers.push(() => {
    router.dispose();
    query.clear();
  });
  return { router, query };
}
beforeEach(() => {
  localStorage.clear();
  expense = expenseFixture();
  category = categoryFixture();
  reads = [];
  categoryReads = [];
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  server.use(
    http.post(`${apiRoot}/auth/refresh`, () => HttpResponse.json(tokenResponse())),
    ...authHandlers(),
    http.get(`${apiRoot}/organizations`, () => HttpResponse.json({ data: [a, b] })),
    http.get(`${apiRoot}/organizations/:org`, ({ params }) =>
      HttpResponse.json({ data: params.org === a.id ? a : b }),
    ),
    http.get(categories, ({ request, params }) => {
      categoryReads.push(new URL(request.url));
      return page(request, [
        {
          ...category,
          organizationId: String(params.org),
          status: new URL(request.url).searchParams.get('status'),
        },
      ]);
    }),
    http.get(root, ({ request, params }) => {
      reads.push(new URL(request.url));
      return page(request, [
        {
          ...(new URL(request.url).searchParams.get('status') === 'VOIDED'
            ? voidedFixture()
            : expense),
          organizationId: String(params.org),
        },
      ]);
    }),
    http.get(`${root}/:id`, ({ params }) =>
      resource({ ...expense, organizationId: String(params.org) }),
    ),
  );
});
afterEach(() => {
  cleanup();
  gates.splice(0).forEach((release) => release());
  disposers.splice(0).forEach((dispose) => dispose());
  localStorage.clear();
  for (const [name, descriptor] of dialogDescriptors) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
async function fillExpense(amount = '40.00') {
  await screen.findByLabelText('Expense amount (USD)');
  await screen.findByRole('option', { name: 'Utilities' });
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Select expense category'), categoryId);
  fireEvent.change(screen.getByLabelText('Expense amount (USD)'), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText('Expense date'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('Expense description'), {
    target: { value: 'Electricity bill' },
  });
  return user;
}
async function openVoid() {
  await screen.findByRole('button', { name: 'Void expense' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Void expense' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Void reason'), {
    target: { value: 'Duplicate expense' },
  });
  return { user, dialog };
}
it('renders lazy expenses, authoritative values and actionable Deep Teal navigation', async () => {
  const { query, router } = mount();
  await routerReady(router);
  await screen.findByRole('table', { name: 'Expense history' });
  expect(screen.getByText('$40.00 USD')).toBeInTheDocument();
  expect(screen.getByText('Electricity bill')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Expenses' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Record expense' })).toHaveAttribute(
    'href',
    path('/new'),
  );
  expect(reads.at(-1)?.searchParams.get('status')).toBe('ACTIVE');
  expect(
    query
      .getQueryCache()
      .getAll()
      .some((q) => q.queryKey.slice(0, 4).join() === expenseKeys.scope(testUser.id, a.id).join()),
  ).toBe(true);
  expect(screen.queryByText(/Total expenses:/)).not.toBeInTheDocument();
});
it('uses literal vendor filters, supported sorts and opaque cursor history', async () => {
  server.use(
    http.get(root, ({ request }) => {
      const url = new URL(request.url);
      reads.push(url);
      return page(request, [expense], url.searchParams.has('after') ? null : 'next_expense');
    }),
  );
  mount();
  await screen.findByRole('table');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Next expenses' }));
  await screen.findByRole('table');
  expect(reads.at(-1)?.searchParams.get('after')).toBe('next_expense');
  await user.click(screen.getByRole('button', { name: 'Previous expenses' }));
  await screen.findByRole('table');
  expect(reads.at(-1)?.searchParams.has('after')).toBe(false);
  await user.type(screen.getByLabelText('Search vendor / payee'), 'Utility_%');
  await waitFor(() => expect(reads.at(-1)?.searchParams.get('vendor')).toBe('Utility_%'));
  await screen.findByRole('table');
  await user.selectOptions(screen.getByLabelText('Sort expenses by'), 'vendorPayee');
  await screen.findByRole('table');
  expect(reads.at(-1)?.searchParams.get('sortBy')).toBe('vendorPayee');
  await user.selectOptions(screen.getByLabelText('Expense page size'), '50');
  await screen.findByRole('table');
  expect(reads.at(-1)?.searchParams.get('limit')).toBe('50');
});
it('filters voided history and archived categories using supported backend queries', async () => {
  mount();
  await screen.findByRole('table');
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Expense status'), 'VOIDED');
  await screen.findByRole('cell', { name: 'VOIDED' });
  await user.selectOptions(screen.getByLabelText('Category choice status'), 'ARCHIVED');
  await screen.findByRole('option', { name: 'Utilities' });
  await user.selectOptions(screen.getByLabelText('Filter by category'), categoryId);
  await screen.findByRole('table');
  expect(reads.at(-1)?.searchParams.get('categoryId')).toBe(categoryId);
  expect(reads.at(-1)?.searchParams.get('status')).toBe('VOIDED');
  expect(categoryReads.at(-1)?.searchParams.get('status')).toBe('ARCHIVED');
});
it('blocks reversed and excessive date ranges without showing stale expense rows', async () => {
  mount();
  await screen.findByRole('table');
  fireEvent.change(screen.getByLabelText('Expense date from'), { target: { value: '2026-10-02' } });
  fireEvent.change(screen.getByLabelText('Expense date to'), { target: { value: '2026-10-01' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('ordered');
  expect(screen.queryByRole('table', { name: 'Expense history' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Expense date from'), { target: { value: '2000-01-01' } });
  expect(screen.getByRole('alert')).toHaveTextContent('1,825');
});
it('renders loading and empty expense results with no invented totals', async () => {
  const pending = deferred(),
    started = deferred();
  server.use(
    http.get(root, async ({ request }) => {
      started.resolve();
      await pending.promise;
      return page(request, []);
    }),
  );
  mount();
  await started.promise;
  await screen.findByText('Loading expenses…');
  pending.resolve();
  expect(await screen.findByText('No expenses match these filters.')).toBeInTheDocument();
});
it.each([403, 404])(
  'conceals protected expense detail after backend rejection %s',
  async (status) => {
    server.use(http.get(`${root}/:id`, () => authFailure('RESOURCE_NOT_FOUND', status)));
    mount(path(`/${expenseId}`));
    await screen.findByRole('heading', {
      name: status === 404 ? 'Expense not found' : 'Access denied',
    });
    expect(screen.queryByText('$40.00 USD')).not.toBeInTheDocument();
    expect(screen.queryByText('Private server text')).not.toBeInTheDocument();
  },
);
it('recovers a read network failure via explicit retry', async () => {
  let fail = true;
  server.use(
    http.get(root, ({ request }) => (fail ? HttpResponse.error() : page(request, [expense]))),
  );
  const { query } = mount();
  query.setDefaultOptions({ queries: { ...query.getDefaultOptions().queries, retryDelay: 0 } });
  await screen.findByRole('button', { name: 'Retry expense request' });
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Retry expense request' }));
  expect(await screen.findByRole('table', { name: 'Expense history' })).toBeInTheDocument();
});
it('restarts invalid expense cursors without fabricating replacement tokens', async () => {
  server.use(
    http.get(root, ({ request }) =>
      new URL(request.url).searchParams.has('after')
        ? authFailure('INVALID_CURSOR', 400)
        : page(request, [expense], 'bad_expense_cursor'),
    ),
  );
  mount();
  await screen.findByRole('table');
  await userEvent.click(screen.getByRole('button', { name: 'Next expenses' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Restart expense pagination' }));
  expect(await screen.findByRole('table')).toBeInTheDocument();
});
it('pages category choices without loading the entire collection and preserves selection', async () => {
  const otherId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccd';
  server.use(
    http.get(categories, ({ request }) => {
      const url = new URL(request.url);
      categoryReads.push(url);
      return page(
        request,
        [
          url.searchParams.has('after')
            ? categoryFixture({ id: otherId, name: 'Travel' })
            : category,
        ],
        url.searchParams.has('after') ? null : 'category_next',
      );
    }),
  );
  mount(path('/new'));
  await screen.findByRole('option', { name: 'Utilities' });
  const user = userEvent.setup();
  expect(categoryReads.some((url) => url.searchParams.has('after'))).toBe(false);
  await user.selectOptions(screen.getByLabelText('Select expense category'), categoryId);
  await user.click(screen.getByRole('button', { name: 'Next category choices' }));
  await screen.findByRole('option', { name: 'Travel' });
  expect(screen.getByLabelText('Select expense category')).toHaveValue(categoryId);
  expect(categoryReads.at(-1)?.searchParams.get('after')).toBe('category_next');
  expect(categoryReads.at(-1)?.searchParams.get('status')).toBe('ACTIVE');
});
it('validates empty fields, precision and positive expense amounts without submitting', async () => {
  let calls = 0;
  server.use(
    http.post(root, () => {
      calls++;
      return resource();
    }),
  );
  mount(path('/new'));
  await screen.findByLabelText('Expense amount (USD)');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Record expense' }));
  await screen.findByText('Use canonical decimal text with up to four decimal places.');
  await fillExpense('0');
  await user.click(screen.getByRole('button', { name: 'Record expense' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('positive');
  fireEvent.change(screen.getByLabelText('Expense amount (USD)'), { target: { value: '0.001' } });
  await user.click(screen.getByRole('button', { name: 'Record expense' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('decimal places');
  expect(calls).toBe(0);
});
it('defaults expense business dates to organization-local today', async () => {
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}`, () =>
      HttpResponse.json({ data: { ...a, timezone: 'Pacific/Kiritimati' } }),
    ),
  );
  mount(path('/new'));
  await screen.findByLabelText('Expense date');
  expect(screen.getByLabelText('Expense date')).toHaveValue(localToday('Pacific/Kiritimati'));
});
it('records once using only the exact DTO and invalidates expense/dashboard/cash-flow/P&L scopes', async () => {
  const pending = deferred(),
    started = deferred();
  let calls = 0;
  server.use(
    http.post(root, async ({ request }) => {
      calls++;
      expect(request.headers.has('Idempotency-Key')).toBe(false);
      expect(request.headers.has('If-Match')).toBe(false);
      expect(await request.json()).toEqual({
        categoryId,
        amount: '40.00',
        expenseDate: '2026-10-01',
        description: 'Electricity bill',
        vendorPayee: null,
        reference: null,
        notes: null,
      });
      started.resolve();
      await pending.promise;
      return HttpResponse.json({ data: expense }, { status: 201, headers: { ETag: '"3"' } });
    }),
  );
  const { query } = mount(path('/new'));
  const user = await fillExpense();
  const keys = [
    ...['dashboard', 'cash-flow', 'profit-loss'].map((kind) => [
      ...organizationKeys.scope(testUser.id, a.id),
      kind,
      'sentinel',
    ]),
    [...expenseKeys.scope(testUser.id, a.id), 'sentinel'],
  ];
  const other = [...organizationKeys.scope(testUser.id, b.id), 'dashboard', 'sentinel'];
  const aging = [...organizationKeys.scope(testUser.id, a.id), 'receivables-aging', 'sentinel'];
  for (const key of [...keys, other, aging]) query.setQueryData(key, 'old');
  await user.dblClick(screen.getByRole('button', { name: 'Record expense' }));
  await started.promise;
  expect(screen.getByRole('button', { name: 'Saving expense…' })).toBeDisabled();
  pending.resolve();
  await screen.findByRole('heading', { name: 'Expense details' });
  expect(calls).toBe(1);
  for (const key of keys) expect(query.getQueryState(key)?.isInvalidated).toBe(true);
  expect(query.getQueryState(other)?.isInvalidated).toBe(false);
  expect(query.getQueryState(aging)?.isInvalidated).toBe(false);
});
it('blocks uncertain expense creation without generating an idempotency key or automatically retrying', async () => {
  let calls = 0;
  server.use(
    http.post(root, () => {
      calls++;
      return HttpResponse.error();
    }),
  );
  mount(path('/new'));
  const user = await fillExpense();
  await user.click(screen.getByRole('button', { name: 'Record expense' }));
  await screen.findByText(/Creation may have completed/);
  expect(screen.getByRole('button', { name: 'Record expense' })).toBeDisabled();
  expect(
    screen.getByRole('link', { name: 'Check expense list before another submission' }),
  ).toBeInTheDocument();
  expect(calls).toBe(1);
});
it('edits active expenses with the exact ETag and explicit nullable clears', async () => {
  server.use(
    http.patch(`${root}/:id`, async ({ request }) => {
      expect(request.headers.get('If-Match')).toBe('"3"');
      expect(request.headers.has('Idempotency-Key')).toBe(false);
      const body = await request.json();
      expect(body).toEqual({
        categoryId,
        amount: '50.00',
        expenseDate: '2026-10-01',
        description: 'Electricity bill',
        vendorPayee: null,
        reference: null,
        notes: null,
      });
      expense = expenseFixture({
        amount: '50.00',
        vendorPayee: null,
        reference: null,
        notes: null,
        version: 4,
      });
      return resource();
    }),
  );
  mount(path(`/${expenseId}/edit`));
  await screen.findByRole('heading', { name: 'Edit expense' });
  expect(screen.getByLabelText('Expense notes (optional)')).toHaveValue('Paid in cash');
  const user = userEvent.setup();
  for (const label of [
    'Vendor / payee (optional)',
    'Expense reference (optional)',
    'Expense notes (optional)',
  ])
    await user.clear(screen.getByLabelText(label));
  fireEvent.change(screen.getByLabelText('Expense amount (USD)'), { target: { value: '50.00' } });
  await user.click(screen.getByRole('button', { name: 'Save expense' }));
  await screen.findByRole('heading', { name: 'Expense details' });
  expect(screen.getByText('$50.00 USD')).toBeInTheDocument();
});
it('allows retaining an existing archived category while editing unrelated expense fields', async () => {
  expense = expenseFixture({ category: { ...expense.category, status: 'ARCHIVED' } });
  server.use(
    http.get(categories, ({ request }) => page(request, [])),
    http.patch(`${root}/:id`, async ({ request }) => {
      expect(((await request.json()) as { categoryId: string }).categoryId).toBe(categoryId);
      expense = { ...expense, version: 4 };
      return resource();
    }),
  );
  mount(path(`/${expenseId}/edit`));
  await screen.findByRole('option', { name: 'Utilities · ARCHIVED (existing assignment)' });
  expect(screen.getByLabelText('Select expense category')).toHaveValue(categoryId);
  await userEvent.click(screen.getByRole('button', { name: 'Save expense' }));
  await screen.findByRole('heading', { name: 'Expense details' });
});
it('handles inactive category assignment without replaying or losing recoverable form input', async () => {
  let calls = 0;
  server.use(
    http.post(root, () => {
      calls++;
      return authFailure('EXPENSE_CATEGORY_INACTIVE', 409);
    }),
  );
  mount(path('/new'));
  const user = await fillExpense();
  await user.click(screen.getByRole('button', { name: 'Record expense' }));
  expect(
    await screen.findByText('This category was archived. Choose an active category.'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Expense amount (USD)')).toHaveValue('40.00');
  expect(calls).toBe(1);
});
it('requires explicit reload on stale editing and uses the fresh ETag after reload', async () => {
  let calls = 0;
  server.use(
    http.patch(`${root}/:id`, async ({ request }) => {
      calls++;
      if (calls === 1) {
        expense = expenseFixture({ amount: '60.00', version: 4 });
        return authFailure('CONCURRENT_MODIFICATION', 409);
      }
      expect(request.headers.get('If-Match')).toBe('"4"');
      expense = { ...expense, version: 5 };
      return resource();
    }),
  );
  mount(path(`/${expenseId}/edit`));
  await screen.findByRole('heading', { name: 'Edit expense' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Save expense' }));
  await screen.findByRole('button', { name: 'Reload expense (discard edits)' });
  expect(screen.getByRole('button', { name: 'Save expense' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Reload expense (discard edits)' }));
  await screen.findByRole('heading', { name: 'Edit expense' });
  expect(screen.getByLabelText('Expense amount (USD)')).toHaveValue('60.00');
  await user.click(screen.getByRole('button', { name: 'Save expense' }));
  await screen.findByRole('heading', { name: 'Expense details' });
  expect(calls).toBe(2);
});
it('blocks uncertain editing until an authoritative reload', async () => {
  server.use(http.patch(`${root}/:id`, () => HttpResponse.error()));
  mount(path(`/${expenseId}/edit`));
  await screen.findByRole('heading', { name: 'Edit expense' });
  await userEvent.click(screen.getByRole('button', { name: 'Save expense' }));
  await screen.findByText(/update outcome is uncertain/);
  expect(screen.getByRole('button', { name: 'Save expense' })).toBeDisabled();
});
it('renders immutable voided detail and rejects the direct edit route', async () => {
  expense = voidedFixture();
  const { router } = mount(path(`/${expenseId}`));
  await screen.findByRole('region', { name: 'Expense void evidence' });
  expect(screen.getByText('Duplicate expense')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Void expense' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Edit expense' })).not.toBeInTheDocument();
  await act(async () => {
    await router.navigate(path(`/${expenseId}/edit`));
  });
  await screen.findByRole('heading', { name: 'Expense is voided' });
  expect(screen.queryByRole('button', { name: 'Save expense' })).not.toBeInTheDocument();
});
it('requires reason/confirmation and accessible keyboard containment for voiding', async () => {
  mount(path(`/${expenseId}`));
  await screen.findByRole('button', { name: 'Void expense' });
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name: 'Void expense' });
  await user.click(trigger);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/No bank transaction is reversed/)).toHaveTextContent(
    '$40.00 USD',
  );
  expect(within(dialog).getByRole('button', { name: 'Keep expense unchanged' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(within(dialog).getByLabelText('Void reason')).toHaveFocus();
  await user.tab({ shift: true });
  expect(within(dialog).getByRole('button', { name: 'Confirm expense void' })).toHaveFocus();
  await user.tab();
  expect(within(dialog).getByLabelText('Void reason')).toHaveFocus();
  await user.click(within(dialog).getByRole('button', { name: 'Confirm expense void' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('visible reason');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
it('voids once with exact If-Match, reason only and no idempotency header', async () => {
  const pending = deferred(),
    started = deferred();
  let calls = 0;
  server.use(
    http.post(`${root}/:id/void`, async ({ request }) => {
      calls++;
      expect(request.headers.get('If-Match')).toBe('"3"');
      expect(request.headers.has('Idempotency-Key')).toBe(false);
      expect(await request.json()).toEqual({ reason: 'Duplicate expense' });
      started.resolve();
      await pending.promise;
      expense = voidedFixture();
      return resource();
    }),
  );
  mount(path(`/${expenseId}`));
  const { user, dialog } = await openVoid();
  await user.dblClick(within(dialog).getByRole('button', { name: 'Confirm expense void' }));
  await started.promise;
  expect(within(dialog).getByRole('button', { name: 'Applying expense action…' })).toBeDisabled();
  pending.resolve();
  await screen.findByRole('region', { name: 'Expense void evidence' });
  expect(calls).toBe(1);
});
it.each(['EXPENSE_ALREADY_VOIDED', 'CONCURRENT_MODIFICATION', 'NETWORK_ERROR'])(
  'blocks repeated void after %s and provides explicit reload',
  async (code) => {
    let calls = 0;
    server.use(
      http.post(`${root}/:id/void`, () => {
        calls++;
        return code === 'NETWORK_ERROR' ? HttpResponse.error() : authFailure(code, 409);
      }),
    );
    mount(path(`/${expenseId}`));
    const { user, dialog } = await openVoid();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm expense void' }));
    await within(dialog).findByRole('button', { name: 'Reload expense before another action' });
    expect(within(dialog).getByRole('button', { name: 'Confirm expense void' })).toBeDisabled();
    expect(calls).toBe(1);
  },
);
it('lists categories with only supported filters and server cursor pagination', async () => {
  server.use(
    http.get(categories, ({ request }) => {
      const url = new URL(request.url);
      categoryReads.push(url);
      return page(
        request,
        [{ ...category, status: url.searchParams.get('status') }],
        url.searchParams.has('after') ? null : 'category_cursor',
      );
    }),
  );
  mount(categoryPath());
  await screen.findByRole('table', { name: 'Expense category directory' });
  const user = userEvent.setup();
  expect(screen.getByText(/Default category/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next categories' }));
  await screen.findByRole('table');
  expect(categoryReads.at(-1)?.searchParams.get('after')).toBe('category_cursor');
  await user.selectOptions(screen.getByLabelText('Category status'), 'ARCHIVED');
  await screen.findByRole('table');
  expect(categoryReads.at(-1)?.searchParams.has('after')).toBe(false);
  expect(screen.queryByRole('button', { name: 'Edit category Utilities' })).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Archive category Utilities' }),
  ).not.toBeInTheDocument();
});
it('creates a category once with name/description only and no concurrency/idempotency headers', async () => {
  const pending = deferred(),
    started = deferred();
  let calls = 0;
  server.use(
    http.post(categories, async ({ request }) => {
      calls++;
      expect(await request.json()).toEqual({
        name: '  Office   supplies  ',
        description: 'Stationery',
      });
      expect(request.headers.has('If-Match')).toBe(false);
      expect(request.headers.has('Idempotency-Key')).toBe(false);
      started.resolve();
      await pending.promise;
      category = categoryFixture({
        name: 'Office supplies',
        systemKey: null,
        description: 'Stationery',
      });
      return HttpResponse.json({ data: category }, { status: 201 });
    }),
  );
  mount(categoryPath());
  await screen.findByRole('table');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add category' }));
  fireEvent.change(screen.getByLabelText('Category name'), {
    target: { value: '  Office   supplies  ' },
  });
  fireEvent.change(screen.getByLabelText('Category description'), {
    target: { value: 'Stationery' },
  });
  await user.dblClick(screen.getByRole('button', { name: 'Create category' }));
  await started.promise;
  expect(screen.getByRole('button', { name: 'Saving category…' })).toBeDisabled();
  pending.resolve();
  await screen.findByRole('table');
  expect(await screen.findByText('Office supplies')).toBeInTheDocument();
  expect(calls).toBe(1);
});
it('exposes duplicate normalized names safely without client collection-based uniqueness', async () => {
  server.use(http.post(categories, () => authFailure('EXPENSE_CATEGORY_ALREADY_EXISTS', 409)));
  mount(categoryPath());
  await screen.findByRole('table');
  await userEvent.click(screen.getByRole('button', { name: 'Add category' }));
  fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'UTILITIES' } });
  await userEvent.click(screen.getByRole('button', { name: 'Create category' }));
  expect(
    await screen.findByText('This name is already reserved, including archived categories.'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Category name')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByText('Private server text')).not.toBeInTheDocument();
});
it('renames default categories without changing systemKey and uses no invented ETag', async () => {
  server.use(
    http.patch(`${categories}/:id`, async ({ request }) => {
      expect(request.headers.has('If-Match')).toBe(false);
      expect(request.headers.has('Idempotency-Key')).toBe(false);
      expect(await request.json()).toEqual({
        name: 'Utility bills',
        description: 'Operating costs',
      });
      category = { ...category, name: 'Utility bills', updatedAt: '2026-10-02T12:00:00.000Z' };
      return HttpResponse.json({ data: category });
    }),
  );
  mount(categoryPath());
  await screen.findByRole('table');
  await userEvent.click(screen.getByRole('button', { name: 'Edit category Utilities' }));
  fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Utility bills' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save category' }));
  expect(await screen.findByText('Utility bills')).toBeInTheDocument();
  expect(category.systemKey).toBe('UTILITIES');
});
it('does not allow clearing existing category descriptions and blocks archived category update conflicts', async () => {
  let calls = 0;
  server.use(
    http.patch(`${categories}/:id`, () => {
      calls++;
      return authFailure('EXPENSE_CATEGORY_NOT_EDITABLE', 409);
    }),
  );
  mount(categoryPath());
  await screen.findByRole('table');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit category Utilities' }));
  await user.clear(screen.getByLabelText('Category description'));
  await user.click(screen.getByRole('button', { name: 'Save category' }));
  await screen.findByText(/does not support clearing/);
  expect(calls).toBe(0);
  fireEvent.change(screen.getByLabelText('Category description'), {
    target: { value: 'Operating costs' },
  });
  await user.click(screen.getByRole('button', { name: 'Save category' }));
  await screen.findByRole('button', { name: 'Reload category records before another submission' });
  expect(screen.getByRole('button', { name: 'Save category' })).toBeDisabled();
  expect(calls).toBe(1);
});
it('blocks uncertain category saving without automatically resubmitting', async () => {
  let calls = 0;
  server.use(
    http.post(categories, () => {
      calls++;
      return HttpResponse.error();
    }),
  );
  mount(categoryPath());
  await screen.findByRole('table');
  await userEvent.click(screen.getByRole('button', { name: 'Add category' }));
  fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Travel' } });
  await userEvent.click(screen.getByRole('button', { name: 'Create category' }));
  await screen.findByText(/save outcome is uncertain/);
  expect(screen.getByRole('button', { name: 'Create category' })).toBeDisabled();
  expect(calls).toBe(1);
});
it('archives default categories with empty body, supports explicit repeat-safe retry and accepts already archived responses', async () => {
  let calls = 0;
  server.use(
    http.post(`${categories}/:id/archive`, async ({ request }) => {
      calls++;
      expect(await request.json()).toEqual({});
      expect(request.headers.has('If-Match')).toBe(false);
      expect(request.headers.has('Idempotency-Key')).toBe(false);
      if (calls === 1) return HttpResponse.error();
      return HttpResponse.json({ data: { ...category, status: 'ARCHIVED' } });
    }),
  );
  mount(categoryPath());
  await screen.findByRole('table');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Archive category Utilities' }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Confirm category archive' }));
  await within(dialog).findByRole('alert');
  expect(calls).toBe(1);
  await user.click(within(dialog).getByRole('button', { name: 'Confirm category archive' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls).toBe(2);
});
it('renders empty category management and failed category choices safely', async () => {
  server.use(http.get(categories, ({ request }) => page(request, [])));
  const { router } = mount(categoryPath());
  await routerReady(router);
  await screen.findByText('No active expense categories on this page.');
  server.use(http.get(categories, () => authFailure('FORBIDDEN', 403)));
  await act(async () => {
    await router.navigate(path('/new'));
  });
  expect(await screen.findByRole('button', { name: 'Retry category choices' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Utilities' })).not.toBeInTheDocument();
});
it('allows viewer reads but hides expense/category writes and denies direct editing', async () => {
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}`, () =>
      HttpResponse.json({ data: { ...a, membership: { ...a.membership, role: 'VIEWER' } } }),
    ),
  );
  const { router } = mount();
  await screen.findByRole('table');
  expect(screen.getByRole('link', { name: 'Expenses' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Record expense' })).not.toBeInTheDocument();
  await act(async () => {
    await router.navigate(categoryPath());
  });
  await screen.findByRole('table');
  expect(screen.queryByRole('button', { name: 'Add category' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit category Utilities' })).not.toBeInTheDocument();
  await act(async () => {
    await router.navigate(path(`/${expenseId}/edit`));
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
});
it('denies member expense reads and hides their navigation without querying expenses', async () => {
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}`, () =>
      HttpResponse.json({ data: { ...a, membership: { ...a.membership, role: 'MEMBER' } } }),
    ),
  );
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  expect(screen.queryByRole('link', { name: 'Expenses' })).not.toBeInTheDocument();
  expect(reads).toEqual([]);
});
it('cancels stale tenant reads and removes obsolete financial cache', async () => {
  const pending = deferred(),
    started = deferred();
  let signal: AbortSignal | undefined;
  server.use(
    http.get(root, async ({ request, params }) => {
      if (params.org === a.id) {
        signal = request.signal;
        started.resolve();
        await pending.promise;
      }
      return page(request, [
        expenseFixture({
          organizationId: String(params.org),
          description: params.org === a.id ? 'Old tenant expense' : 'Beta expense',
        }),
      ]);
    }),
  );
  const { query, router } = mount();
  await started.promise;
  await userEvent.selectOptions(screen.getByLabelText('Organization'), b.id);
  await screen.findByText('Beta expense');
  expect(signal?.aborted).toBe(true);
  pending.resolve();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(screen.queryByText('Old tenant expense')).not.toBeInTheDocument();
  expect(router.state.location.pathname).toBe(path('', b.id));
  expect(query.getQueriesData({ queryKey: expenseKeys.scope(testUser.id, a.id) })).toEqual([]);
});
it('ignores a stale expense mutation after organization switch without redirecting the new tenant', async () => {
  const pending = deferred(),
    started = deferred();
  server.use(
    http.patch(`${root}/:id`, async () => {
      started.resolve();
      await pending.promise;
      return resource({ ...expense, version: 4 });
    }),
  );
  const { router } = mount(path(`/${expenseId}/edit`));
  await screen.findByRole('heading', { name: 'Edit expense' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Save expense' }));
  await started.promise;
  await user.selectOptions(screen.getByLabelText('Organization'), b.id);
  await screen.findByRole('table');
  pending.resolve();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(router.state.location.pathname).toBe(path('', b.id));
  expect(screen.queryByRole('heading', { name: 'Expense details' })).not.toBeInTheDocument();
});
it('switches category management to the new organization and removes old category cache', async () => {
  const { router, query } = mount(categoryPath());
  await screen.findByRole('table');
  await userEvent.selectOptions(screen.getByLabelText('Organization'), b.id);
  await screen.findByRole('table');
  expect(router.state.location.pathname).toBe(categoryPath(b.id));
  expect(query.getQueriesData({ queryKey: categoryKeys.scope(testUser.id, a.id) })).toEqual([]);
});
it('withholds all expense values when membership is revoked', async () => {
  const { query } = mount();
  await screen.findByRole('table');
  server.use(http.get(`${apiRoot}/organizations/${a.id}`, () => authFailure('NOT_FOUND', 404)));
  await act(async () => {
    await query.refetchQueries({ queryKey: organizationKeys.context(testUser.id, a.id) });
  });
  await screen.findByRole('heading', { name: 'Organization unavailable' });
  expect(screen.queryByText('$40.00 USD')).not.toBeInTheDocument();
});
it('does not replay an expense mutation 401 and returns to sign-in', async () => {
  let calls = 0;
  server.use(
    http.post(root, () => {
      calls++;
      return authFailure();
    }),
  );
  mount(path('/new'));
  const user = await fillExpense();
  await user.click(screen.getByRole('button', { name: 'Record expense' }));
  await screen.findByRole('heading', { name: 'Sign in' });
  expect(calls).toBe(1);
});
it('closes category write controls when current membership loses management permission', async () => {
  const { query } = mount(categoryPath());
  await screen.findByRole('table');
  await userEvent.click(screen.getByRole('button', { name: 'Edit category Utilities' }));
  expect(screen.getByLabelText('Category name')).toBeInTheDocument();
  const key = organizationKeys.context(testUser.id, a.id);
  const current = query.getQueryData<Organization>(key)!;
  act(() => {
    query.setQueryData(key, { ...current, membership: { ...current.membership, role: 'VIEWER' } });
  });
  await waitFor(() => expect(screen.queryByLabelText('Category name')).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Add category' })).not.toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Expense category directory' })).toBeInTheDocument();
});
