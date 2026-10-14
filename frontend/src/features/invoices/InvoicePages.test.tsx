import { StrictMode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { beforeAll, beforeEach, afterEach, expect, it } from 'vitest';
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
  deferred,
  testUser,
  tokenResponse,
} from '../../test/auth-fixtures';
import { dashboardOrg as a, secondOrg as b } from '../dashboard/test-fixtures';
import { invoiceKeys } from './queries';
import { financialKeys } from '../financials/query-keys';
import { parseInvoice, type Invoice } from './contracts';
import { safeReturnTo } from '../../auth/return-to';
const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const instant = '2026-10-11T10:00:00.000Z';
function document(overrides: Partial<Invoice> = {}): Invoice {
  const issued = overrides.status && overrides.status !== 'DRAFT';
  return {
    id,
    organizationId: a.id,
    customerId,
    status: 'DRAFT',
    invoiceNumber: issued ? 'INV-000001' : null,
    sequenceValue: issued ? '1' : null,
    numberPrefix: issued ? 'INV-' : null,
    customer: { id: customerId, displayName: 'Original customer', email: 'billing@example.test' },
    paymentState: overrides.status === 'ISSUED' ? 'UNPAID' : 'NOT_APPLICABLE',
    isOverdue: false,
    issueDate: '2026-10-01',
    dueDate: '2026-10-31',
    currency: 'USD',
    discount: { type: 'NONE', value: '0' },
    taxRate: '0',
    items: [
      {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        description: 'Consulting',
        quantity: '3',
        unitPrice: '33.3350',
        lineAmount: '100.01',
        sortOrder: 0,
      },
    ],
    subtotal: '100.01',
    discountTotal: '0.00',
    taxableTotal: '100.01',
    taxTotal: '0.00',
    total: '100.01',
    amountPaid: '0.00',
    balanceDue: '100.01',
    createdByUserId: testUser.id,
    issuedByUserId: issued ? testUser.id : null,
    issuedAt: issued ? instant : null,
    cancelledAt: null,
    cancelReason: null,
    voidedAt: null,
    voidReason: null,
    version: 3,
    createdAt: instant,
    updatedAt: instant,
    ...overrides,
  };
}
const resource = (data = document()) =>
  HttpResponse.json({ data }, { headers: { ETag: `"${data.version}"` } });
const page = (request: Request, data = [document()], nextCursor: string | null = null) =>
  HttpResponse.json({
    data,
    meta: {
      limit: Number(new URL(request.url).searchParams.get('limit')),
      nextCursor,
      hasMore: nextCursor !== null,
    },
  });
const path = (suffix = '', org = a.id) => `/organizations/${org}/invoices${suffix}`;
const root = `${apiRoot}/organizations/:org/invoices`;
const customers = `${apiRoot}/organizations/:org/customers`;
const choice = {
  id: customerId,
  organizationId: a.id,
  displayName: 'Active customer',
  customerCode: null,
  email: null,
  status: 'ACTIVE',
  createdByUserId: testUser.id,
  version: 1,
  createdAt: instant,
  updatedAt: instant,
};
let reads: URL[];
const dispose: (() => void)[] = [];
beforeAll(async () => {
  await import('./InvoicePages');
});
function mount(suffix = '', org = a.id) {
  const query = createQueryClient();
  const session = createSession(query, apiRoot);
  const router = createMemoryRouter(routes, { initialEntries: [path(suffix, org)] });
  render(
    <StrictMode>
      <QueryClientProvider client={query}>
        <AuthProvider session={session}>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
  dispose.push(() => {
    router.dispose();
    query.clear();
  });
  return { query, router };
}
beforeEach(() => {
  localStorage.clear();
  reads = [];
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
    http.get(customers, ({ params }) =>
      HttpResponse.json({
        data: [{ ...choice, organizationId: String(params.org) }],
        meta: { limit: 25, nextCursor: null, hasMore: false },
      }),
    ),
    http.get(root, ({ request, params }) => {
      reads.push(new URL(request.url));
      return page(request, [
        document({
          organizationId: String(params.org),
          customer: {
            id: customerId,
            displayName: params.org === a.id ? 'Original customer' : 'Beta invoice customer',
            email: null,
          },
        }),
      ]);
    }),
    http.get(`${root}/:id`, () => resource()),
  );
});
afterEach(() => {
  dispose.splice(0).forEach((f) => f());
});
async function completeCreate() {
  await screen.findByRole('heading', { name: 'Create invoice' });
  const user = userEvent.setup();
  await screen.findByRole('option', { name: 'Active customer' });
  await user.selectOptions(screen.getByLabelText('Invoice customer'), customerId);
  fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-10-31' } });
  await user.type(screen.getByLabelText('Description 1'), 'Consulting');
  await user.clear(screen.getByLabelText('Unit price 1'));
  await user.type(screen.getByLabelText('Unit price 1'), '33.335');
  return user;
}
it('renders lazy invoices with authoritative amounts, dates, scoped query keys and navigation', async () => {
  const { query, router } = mount();
  await routerReady(router);
  await screen.findByRole('table', { name: 'Invoice directory' });
  expect(screen.getByRole('link', { name: 'Invoices' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('$100.01')).toBeInTheDocument();
  expect(reads.at(-1)?.searchParams.get('sortBy')).toBe('issueDate');
  expect(reads.at(-1)?.searchParams.has('status')).toBe(false);
  expect(
    query
      .getQueryCache()
      .getAll()
      .some((q) => q.queryKey.slice(0, 4).join() === invoiceKeys.scope(testUser.id, a.id).join()),
  ).toBe(true);
  expect(screen.getByText('Showing 1 invoices on this page.')).toBeInTheDocument();
});
it('debounces literal search and resets pagination for filters and sorting', async () => {
  server.use(
    http.get(root, ({ request }) => {
      reads.push(new URL(request.url));
      return page(
        request,
        [
          document({
            status:
              new URL(request.url).searchParams.get('status') === 'ISSUED' ? 'ISSUED' : 'DRAFT',
          }),
        ],
        new URL(request.url).searchParams.has('after') ? null : 'opaque_next',
      );
    }),
  );
  mount();
  await screen.findByRole('table', { name: 'Invoice directory' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Next invoices' }));
  await screen.findByText('Invoice page 2');
  expect(reads.at(-1)?.searchParams.get('after')).toBe('opaque_next');
  await user.click(screen.getByRole('button', { name: 'Previous invoices' }));
  await screen.findByText('Invoice page 1');
  await user.type(screen.getByLabelText('Search invoices'), 'INV');
  await waitFor(() => expect(reads.at(-1)?.searchParams.get('search')).toBe('INV'));
  expect(screen.getByLabelText('Search invoices')).toHaveValue('INV');
  await user.selectOptions(screen.getByLabelText('Invoice status'), 'ISSUED');
  await screen.findByText('INV-000001');
  expect(reads.at(-1)?.searchParams.has('after')).toBe(false);
  await user.selectOptions(screen.getByLabelText('Sort invoices by'), 'invoiceNumber');
  await waitFor(() => expect(reads.at(-1)?.searchParams.get('sortBy')).toBe('invoiceNumber'));
});
it('loads only one page of active customer choices and advances using the returned cursor', async () => {
  const requests: URL[] = [];
  server.use(
    http.get(customers, ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      return HttpResponse.json({
        data: [
          {
            ...choice,
            displayName: url.searchParams.has('after')
              ? 'Second-page customer'
              : 'First-page customer',
          },
        ],
        meta: {
          limit: 25,
          nextCursor: url.searchParams.has('after') ? null : 'customer_cursor',
          hasMore: !url.searchParams.has('after'),
        },
      });
    }),
  );
  mount('/new');
  const choices = await screen.findByLabelText('Invoice customer');
  await within(choices).findByRole('option', { name: 'First-page customer' });
  expect(
    requests.every(
      (url) =>
        url.searchParams.get('status') === 'ACTIVE' && url.searchParams.get('limit') === '25',
    ),
  ).toBe(true);
  expect(requests.some((url) => url.searchParams.has('after'))).toBe(false);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Next customers' }));
  await screen.findByRole('option', { name: 'Second-page customer' });
  expect(requests.at(-1)?.searchParams.get('after')).toBe('customer_cursor');
});
it('creates a draft with decimal strings, supported fields and no idempotency header, once', async () => {
  const gate = deferred();
  let calls = 0;
  server.use(
    http.post(root, async ({ request }) => {
      calls++;
      const body = (await request.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual([
        'customerId',
        'discount',
        'dueDate',
        'issueDate',
        'items',
        'taxRate',
      ]);
      expect(body.items).toEqual([
        { description: 'Consulting', quantity: '1', unitPrice: '33.335', sortOrder: 0 },
      ]);
      expect(request.headers.has('Idempotency-Key')).toBe(false);
      await gate.promise;
      return resource();
    }),
  );
  const { router } = mount('/new');
  const user = await completeCreate();
  await user.dblClick(screen.getByRole('button', { name: 'Create draft' }));
  await waitFor(() => expect(calls).toBe(1));
  expect(screen.getByRole('button', { name: 'Saving invoice…' })).toBeDisabled();
  gate.resolve();
  await waitFor(() => expect(router.state.location.pathname).toBe(path(`/${id}`)));
});
it('validates required fields, invalid line items and supports keyboard add/remove', async () => {
  mount('/new');
  await screen.findByRole('heading', { name: 'Create invoice' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Create draft' }));
  await screen.findByText('Select a valid customer.');
  expect(screen.getByLabelText('Description 1')).toHaveAttribute('aria-invalid', 'true');
  await user.click(screen.getByRole('button', { name: 'Add item' }));
  expect(screen.getByLabelText('Quantity 2')).toHaveValue('1');
  await user.click(screen.getByRole('button', { name: 'Remove item 1' }));
  expect(screen.queryByLabelText('Quantity 2')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Remove item 1' }));
  await user.click(screen.getByRole('button', { name: 'Create draft' }));
  expect(screen.queryByLabelText('Quantity 1')).not.toBeInTheDocument();
});
it('prepopulates draft fields and PATCHes the exact ETag with no server IDs or totals', async () => {
  let payload: unknown;
  let match: string | null = null;
  server.use(
    http.patch(`${root}/:id`, async ({ request }) => {
      payload = await request.json();
      match = request.headers.get('If-Match');
      return resource(document({ version: 4 }));
    }),
  );
  const { router } = mount(`/${id}/edit`);
  await screen.findByDisplayValue('Consulting');
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText('Description 1'));
  await user.type(screen.getByLabelText('Description 1'), 'Revised service');
  await user.click(screen.getByRole('button', { name: 'Save draft changes' }));
  await waitFor(() => expect(match).toBe('"3"'));
  expect(payload).toMatchObject({
    items: [{ description: 'Revised service', quantity: '3', unitPrice: '33.3350', sortOrder: 0 }],
  });
  await waitFor(() => expect(router.state.location.pathname).toBe(path(`/${id}`)));
});
it('blocks stale edit saves until explicit reload supplies a fresh ETag', async () => {
  let version = 3;
  const matches: (string | null)[] = [];
  server.use(
    http.get(`${root}/:id`, () => resource(document({ version }))),
    http.patch(`${root}/:id`, ({ request }) => {
      matches.push(request.headers.get('If-Match'));
      if (version === 3) {
        version = 4;
        return authFailure('CONCURRENT_MODIFICATION', 409);
      }
      return resource(document({ version: 5 }));
    }),
  );
  mount(`/${id}/edit`);
  await screen.findByDisplayValue('Consulting');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Save draft changes' }));
  await screen.findByText(/changed or was finalized/);
  expect(screen.getByRole('button', { name: 'Save draft changes' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Reload invoice (discard draft)' }));
  await screen.findByDisplayValue('Consulting');
  await user.click(screen.getByRole('button', { name: 'Save draft changes' }));
  await waitFor(() => expect(matches).toEqual(['"3"', '"4"']));
});
it('presents frozen issued snapshots and rejects the direct edit route', async () => {
  server.use(http.get(`${root}/:id`, () => resource(document({ status: 'ISSUED' }))));
  const { router } = mount(`/${id}`);
  await screen.findByRole('heading', { name: 'INV-000001' });
  expect(screen.getByText('Original customer')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Edit draft' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete draft' })).not.toBeInTheDocument();
  expect(screen.getByText(/snapshot.*immutable/)).toBeInTheDocument();
  await router.navigate(path(`/${id}/edit`));
  await screen.findByRole('heading', { name: 'Invoice is finalized' });
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
});
it('confirms issuance once with exact If-Match, empty body and no key header', async () => {
  const gate = deferred();
  let issued = false;
  let calls = 0;
  server.use(
    http.get(`${root}/:id`, () =>
      resource(document({ status: issued ? 'ISSUED' : 'DRAFT', version: issued ? 4 : 3 })),
    ),
    http.post(`${root}/:id/issue`, async ({ request }) => {
      calls++;
      expect(request.headers.get('If-Match')).toBe('"3"');
      expect(request.headers.has('Idempotency-Key')).toBe(false);
      expect(await request.json()).toEqual({});
      await gate.promise;
      issued = true;
      return resource(document({ status: 'ISSUED', version: 4 }));
    }),
  );
  const { query } = mount(`/${id}`);
  const reportingKeys = ['dashboard', 'cash-flow', 'profit-loss', 'receivables-aging'].map(
    (kind) => [
      ...financialKeys.scope(
        testUser.id,
        a.id,
        kind as 'dashboard' | 'cash-flow' | 'profit-loss' | 'receivables-aging',
      ),
      'sentinel',
    ],
  );
  const user = userEvent.setup();
  const trigger = await screen.findByRole('button', { name: 'Issue invoice' });
  for (const key of reportingKeys) query.setQueryData(key, 'old');
  await user.click(trigger);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('button', { name: 'Keep invoice unchanged' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
  expect(calls).toBe(0);
  await user.click(trigger);
  await user.dblClick(screen.getByRole('button', { name: 'Confirm issue invoice' }));
  await waitFor(() => expect(calls).toBe(1));
  expect(screen.getByRole('button', { name: 'Applying invoice action…' })).toBeDisabled();
  gate.resolve();
  await screen.findByRole('heading', { name: 'INV-000001' });
  expect(screen.queryByRole('button', { name: 'Issue invoice' })).not.toBeInTheDocument();
  for (const key of reportingKeys)
    expect(query.getQueryState(key)?.isInvalidated).toBe(
      key[3] === 'dashboard' || key[3] === 'receivables-aging',
    );
});
it.each(['cancel', 'void'] as const)(
  'confirms %s only for issued invoices with a reason and no If-Match/key',
  async (action) => {
    let current = document({ status: 'ISSUED' });
    let calls = 0;
    server.use(
      http.get(`${root}/:id`, () => resource(current)),
      http.post(`${root}/:id/${action}`, async ({ request }) => {
        calls++;
        expect(await request.json()).toEqual({ reason: 'Correction required' });
        expect(request.headers.has('If-Match')).toBe(false);
        expect(request.headers.has('Idempotency-Key')).toBe(false);
        current = document({
          status: action === 'cancel' ? 'CANCELLED' : 'VOID',
          version: 4,
          ...(action === 'cancel'
            ? { cancelReason: 'Correction required', cancelledAt: instant }
            : { voidReason: 'Correction required', voidedAt: instant }),
        });
        return resource(current);
      }),
    );
    mount(`/${id}`);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: action === 'cancel' ? 'Cancel issued invoice' : 'Void invoice',
      }),
    );
    const confirm = screen.getByRole('button', {
      name: action === 'cancel' ? 'Confirm cancel issued invoice' : 'Confirm void invoice',
    });
    await user.click(confirm);
    await screen.findByText(/Enter a visible reason/);
    expect(calls).toBe(0);
    await user.type(screen.getByLabelText('Reason'), 'Correction required');
    await user.click(confirm);
    await screen.findByText('Correction required');
    expect(calls).toBe(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  },
);
it('deletes only a confirmed draft with exact If-Match and handles 204', async () => {
  let calls = 0;
  server.use(
    http.delete(`${root}/:id`, async ({ request }) => {
      calls++;
      expect(request.headers.get('If-Match')).toBe('"3"');
      expect(await request.json()).toEqual({});
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const { router } = mount(`/${id}`);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Delete draft' }));
  expect(screen.getByText(/organization currency stays locked/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Confirm delete draft' }));
  await waitFor(() => expect(router.state.location.pathname).toBe(path()));
  expect(calls).toBe(1);
});
it('handles lifecycle conflicts by requiring reload rather than automatically replaying', async () => {
  let calls = 0;
  server.use(
    http.post(`${root}/:id/issue`, () => {
      calls++;
      return authFailure('CONCURRENT_MODIFICATION', 409);
    }),
  );
  mount(`/${id}`);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Issue invoice' }));
  await user.click(screen.getByRole('button', { name: 'Confirm issue invoice' }));
  await screen.findByRole('button', { name: 'Reload invoice before another action' });
  expect(calls).toBe(1);
  expect(screen.getByRole('button', { name: 'Confirm issue invoice' })).toBeDisabled();
});
it('blocks zero-total issuance and hides cancel/void on drafts', async () => {
  server.use(
    http.get(`${root}/:id`, () => resource(document({ total: '0.00', balanceDue: '0.00' }))),
  );
  mount(`/${id}`);
  expect(await screen.findByRole('button', { name: 'Issue invoice' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Cancel issued invoice' })).not.toBeInTheDocument();
});
it('hides viewer write actions and gates a direct create route without a write', async () => {
  const { router } = mount('', b.id);
  await screen.findByRole('table', { name: 'Invoice directory' });
  expect(screen.queryByRole('link', { name: 'Create invoice' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: `Edit draft ${id}` })).not.toBeInTheDocument();
  await router.navigate(path('/new', b.id));
  await screen.findByText(/Access denied. You do not have permission/);
});
it.each([403, 404])('handles safe invoice response %s', async (status) => {
  server.use(http.get(`${root}/:id`, () => authFailure('RESOURCE_NOT_FOUND', status)));
  mount(`/${id}`);
  await screen.findByRole('heading', {
    name: status === 404 ? 'Invoice not found' : 'Access denied',
  });
  expect(screen.queryByText('Private server text')).not.toBeInTheDocument();
});
it('renders loading, empty results and search-no-results without aggregates', async () => {
  const gate = deferred();
  server.use(
    http.get(root, async ({ request }) => {
      await gate.promise;
      return page(request, []);
    }),
  );
  mount();
  await screen.findByText('Loading invoices…');
  gate.resolve();
  await screen.findByText('No invoices match these filters.');
  await userEvent.setup().type(screen.getByLabelText('Search invoices'), 'unknown');
  await screen.findByText('No invoices match this search.');
});
it('shows a safe network error and recovers through explicit retry', async () => {
  server.use(http.get(root, () => HttpResponse.error()));
  mount();
  await screen.findByRole('heading', { name: 'Invoices unavailable' }, { timeout: 4000 });
  server.use(http.get(root, ({ request }) => page(request)));
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry invoice request' }));
  await screen.findByRole('table', { name: 'Invoice directory' });
});
it('cancels an obsolete tenant read and never displays its late result', async () => {
  const gate = deferred();
  let signal: AbortSignal | undefined;
  server.use(
    http.get(root, async ({ request, params }) => {
      if (params.org === a.id) {
        signal = request.signal;
        await gate.promise;
        return page(request);
      }
      return page(request, [
        document({
          organizationId: b.id,
          customer: { id: customerId, displayName: 'Beta invoice customer', email: null },
        }),
      ]);
    }),
  );
  const { router } = mount();
  await screen.findByText('Loading invoices…');
  await waitFor(() => expect(signal).toBeDefined());
  await userEvent.setup().selectOptions(screen.getByLabelText('Organization'), b.id);
  await screen.findByText('Beta invoice customer');
  await waitFor(() => expect(signal?.aborted).toBe(true));
  gate.resolve();
  expect(router.state.location.pathname).toBe(path('', b.id));
  expect(screen.queryByText('Original customer')).not.toBeInTheDocument();
});
it('ignores a late old-tenant draft mutation redirect and removes old invoice cache', async () => {
  const gate = deferred();
  let started = false;
  server.use(
    http.patch(`${root}/:id`, async () => {
      started = true;
      await gate.promise;
      return resource();
    }),
  );
  const { router, query } = mount(`/${id}/edit`);
  await screen.findByDisplayValue('Consulting');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Save draft changes' }));
  await waitFor(() => expect(started).toBe(true));
  await userEvent.setup().selectOptions(screen.getByLabelText('Organization'), b.id);
  await screen.findByText('Beta invoice customer');
  gate.resolve();
  expect(router.state.location.pathname).toBe(path('', b.id));
  expect(
    query
      .getQueryCache()
      .getAll()
      .some((q) => q.queryKey.includes(a.id) && q.queryKey.includes('invoices')),
  ).toBe(false);
});
it('rejects tenant/currency/ETag contamination and safely allowlists return destinations', () => {
  for (const [org, currency, etag] of [
    [b.id, 'USD', '"3"'],
    [a.id, 'INR', '"3"'],
    [a.id, 'USD', '3'],
  ])
    expect(() =>
      parseInvoice({ data: document() }, new Headers({ ETag: etag! }), org!, currency!),
    ).toThrow();
  expect(invoiceKeys.scope('other-account', a.id)).not.toEqual(
    invoiceKeys.scope(testUser.id, a.id),
  );
  for (const suffix of ['', '/new', `/${id}`, `/${id}/edit`])
    expect(safeReturnTo(path(suffix))).toBe(path(suffix));
  expect(safeReturnTo(path('/invalid/edit'))).toBe('/session');
});
it('blocks uncertain creation without automatic retry', async () => {
  let calls = 0;
  server.use(
    http.post(root, () => {
      calls++;
      return HttpResponse.error();
    }),
  );
  mount('/new');
  const user = await completeCreate();
  await user.click(screen.getByRole('button', { name: 'Create draft' }));
  await screen.findByText(/Creation may have completed/);
  expect(calls).toBe(1);
  expect(screen.getByRole('button', { name: 'Create draft' })).toBeDisabled();
});
it('rejects mutation 401 without automatic replay and returns to sign-in', async () => {
  let calls = 0;
  server.use(
    http.post(root, () => {
      calls++;
      return authFailure();
    }),
  );
  const { router } = mount('/new');
  const user = await completeCreate();
  await user.click(screen.getByRole('button', { name: 'Create draft' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(calls).toBe(1);
});
it('renders safe backend field validation on invoice inputs', async () => {
  server.use(
    http.post(root, () =>
      HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Private error',
            fields: [
              { field: 'items.0.description', code: 'INVALID', message: 'Secret database details' },
            ],
          },
        },
        { status: 400 },
      ),
    ),
  );
  mount('/new');
  const user = await completeCreate();
  await user.click(screen.getByRole('button', { name: 'Create draft' }));
  await screen.findByText('Check this field.');
  expect(screen.getByLabelText('Description 1')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByText('Secret database details')).not.toBeInTheDocument();
});
it('surfaces payment history blockers without inventing a payment workflow', async () => {
  server.use(
    http.get(`${root}/:id`, () => resource(document({ status: 'ISSUED' }))),
    http.post(`${root}/:id/cancel`, () => authFailure('ACTIVE_PAYMENTS_EXIST', 409)),
  );
  mount(`/${id}`);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Cancel issued invoice' }));
  await user.type(screen.getByLabelText('Reason'), 'Correction');
  await user.click(screen.getByRole('button', { name: 'Confirm cancel issued invoice' }));
  await screen.findByText(/Payment history prevents this transition/);
  expect(screen.getByRole('button', { name: 'Confirm cancel issued invoice' })).toBeDisabled();
});
it('restarts invalid cursors and rejects invalid date ranges before requesting them', async () => {
  server.use(
    http.get(root, ({ request }) => {
      reads.push(new URL(request.url));
      return new URL(request.url).searchParams.has('after')
        ? authFailure('INVALID_CURSOR', 400)
        : page(request, [document()], 'next_cursor');
    }),
  );
  mount();
  await screen.findByRole('table', { name: 'Invoice directory' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Next invoices' }));
  await user.click(await screen.findByRole('button', { name: 'Restart invoice pagination' }));
  await screen.findByText('Invoice page 1');
  fireEvent.change(screen.getByLabelText('Invoice date from'), { target: { value: '2026-10-31' } });
  fireEvent.change(screen.getByLabelText('Invoice date to'), { target: { value: '2026-10-01' } });
  await screen.findByText(/Check search length/);
  expect(
    reads.some(
      (url) =>
        url.searchParams.get('issueDateFrom') === '2026-10-31' &&
        url.searchParams.get('issueDateTo') === '2026-10-01',
    ),
  ).toBe(false);
});
