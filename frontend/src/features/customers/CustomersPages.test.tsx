import { StrictMode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthProvider';
import { createSession } from '../../auth/session';
import { createQueryClient } from '../../app/query-client';
import { routes } from '../../routes/routes';
import { server } from '../../test/server';
import {
  apiRoot,
  authHandlers,
  authFailure,
  deferred,
  testUser,
  tokenResponse,
} from '../../test/auth-fixtures';
import { dashboardOrg as a, secondOrg as b } from '../dashboard/test-fixtures';
import { customerKeys } from './queries';
import {
  customerFormSchema,
  customerPayload,
  parseCustomer,
  parseCustomerList,
  type Customer,
} from './contracts';
const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const customer = {
  id,
  organizationId: a.id,
  displayName: 'Acme',
  customerCode: 'C01',
  email: 'acme@example.test',
  status: 'ACTIVE' as const,
  createdByUserId: testUser.id,
  version: 3,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-11T10:00:00.000Z',
};
const base = `${apiRoot}/organizations/:org/customers`;
const path = (suffix = '', org = a.id) => `/organizations/${org}/customers${suffix}`;
const resource = (data: Customer = customer) =>
  HttpResponse.json({ data }, { headers: { ETag: `"${data.version}"` } });
const page = (request: Request, data = [customer], nextCursor: string | null = null) =>
  HttpResponse.json({
    data,
    meta: {
      limit: Number(new URL(request.url).searchParams.get('limit')),
      nextCursor,
      hasMore: nextCursor !== null,
    },
  });
const dispose: (() => void)[] = [];
let reads: URL[];
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
    http.get(base, ({ request, params }) => {
      reads.push(new URL(request.url));
      return page(request, [
        {
          ...customer,
          organizationId: String(params.org),
          displayName: params.org === a.id ? 'Acme' : 'Beta customer',
        },
      ]);
    }),
    http.get(`${base}/:id`, () => resource()),
  );
});
afterEach(() => {
  dispose.splice(0).forEach((f) => f());
  vi.restoreAllMocks();
});
it('renders the lazy directory, accessible actions and scoped filter keys without totals', async () => {
  const { query } = mount();
  await screen.findByRole('table', { name: 'Customer directory' });
  expect(screen.getByRole('link', { name: 'Customers' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Edit Acme' })).toHaveAttribute(
    'href',
    path(`/${id}/edit`),
  );
  expect(reads.at(-1)?.searchParams.get('status')).toBe('ACTIVE');
  expect(
    query
      .getQueryCache()
      .getAll()
      .some((q) =>
        JSON.stringify(q.queryKey).includes(
          JSON.stringify(customerKeys.scope(testUser.id, a.id)).slice(0, -1),
        ),
      ),
  ).toBe(true);
  expect(screen.getByText('Showing 1 customers on this page.')).toBeInTheDocument();
});
it('debounces search, preserves input and avoids invalid one-character requests', async () => {
  mount();
  await screen.findByText('Acme');
  const user = userEvent.setup();
  const input = screen.getByRole('searchbox');
  await user.type(input, 'A');
  expect(screen.getByText(/Enter 2/)).toBeInTheDocument();
  await user.type(input, 'cme');
  expect(input).toHaveValue('Acme');
  await waitFor(() => expect(reads.at(-1)?.searchParams.get('search')).toBe('Acme'));
});
it('uses only returned cursors for next/previous and resets pagination for sort changes', async () => {
  server.use(
    http.get(base, ({ request }) => {
      reads.push(new URL(request.url));
      return page(
        request,
        [customer],
        new URL(request.url).searchParams.has('after') ? null : 'opaque_cursor',
      );
    }),
  );
  mount();
  await screen.findByText('Acme');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('Page 2');
  expect(reads.at(-1)?.searchParams.get('after')).toBe('opaque_cursor');
  await user.click(screen.getByRole('button', { name: 'Previous page' }));
  await screen.findByText('Page 1');
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('Page 2');
  await user.selectOptions(screen.getByLabelText('Sort by'), 'updatedAt');
  await screen.findByText('Page 1');
  expect(reads.at(-1)?.searchParams.has('after')).toBe(false);
  expect(reads.at(-1)?.searchParams.get('sortBy')).toBe('updatedAt');
});
it.each([403, 404])('renders safe server denial %s without private messages', async (status) => {
  server.use(http.get(`${base}/:id`, () => authFailure('CUSTOMER_NOT_FOUND', status)));
  mount(`/${id}`);
  await screen.findByRole('heading', {
    name: status === 403 ? 'Access denied' : 'Customer not found',
  });
  expect(screen.queryByText('Private server text')).not.toBeInTheDocument();
});
it('renders loading then the empty directory', async () => {
  const gate = deferred();
  server.use(
    http.get(base, async ({ request }) => {
      await gate.promise;
      return page(request, []);
    }),
  );
  mount();
  await screen.findByText('Loading customers…');
  gate.resolve();
  await screen.findByText('No active customers yet.');
});
it('renders search-no-results and archived filtering accurately', async () => {
  server.use(
    http.get(base, ({ request }) => {
      reads.push(new URL(request.url));
      return page(request, []);
    }),
  );
  mount();
  await screen.findByText('No active customers yet.');
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Status'), 'ARCHIVED');
  await screen.findByText('No archived customers.');
  await user.type(screen.getByRole('searchbox'), 'missing');
  await screen.findByText('No customers match this search.');
  expect(reads.at(-1)?.searchParams.get('status')).toBe('ARCHIVED');
});
it('creates only supported fields, no idempotency header, and prevents duplicate submissions', async () => {
  let calls = 0;
  const gate = deferred();
  server.use(
    http.post(base, async ({ request }) => {
      calls++;
      expect(request.headers.has('Idempotency-Key')).toBe(false);
      expect(await request.json()).toEqual({
        displayName: 'Acme',
        customerCode: null,
        email: null,
      });
      await gate.promise;
      return resource();
    }),
  );
  const { router } = mount('/new');
  await screen.findByRole('heading', { name: 'Add customer' });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Display name'), 'Acme');
  await user.dblClick(screen.getByRole('button', { name: 'Create customer' }));
  await waitFor(() => expect(calls).toBe(1));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  gate.resolve();
  await waitFor(() => expect(router.state.location.pathname).toBe(path(`/${id}`)));
});
it('validates required name and email before sending a create', async () => {
  mount('/new');
  await screen.findByRole('heading', { name: 'Add customer' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Create customer' }));
  await screen.findByText('Enter visible text.');
  await user.type(screen.getByLabelText('Email address (optional)'), 'bad');
  await user.click(screen.getByRole('button', { name: 'Create customer' }));
  expect(screen.getByLabelText('Email address (optional)')).toHaveAttribute('aria-invalid', 'true');
});
it('handles duplicate codes as a safe field error', async () => {
  server.use(http.post(base, () => authFailure('CUSTOMER_CODE_UNAVAILABLE', 409)));
  mount('/new');
  await screen.findByRole('heading', { name: 'Add customer' });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Display name'), 'Acme');
  await user.click(screen.getByRole('button', { name: 'Create customer' }));
  await screen.findByText('This customer code is already in use.');
});
it('does not retry or replay an uncertain create outcome', async () => {
  let calls = 0;
  server.use(
    http.post(base, () => {
      calls++;
      return HttpResponse.error();
    }),
  );
  mount('/new');
  await screen.findByRole('heading', { name: 'Add customer' });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Display name'), 'Acme');
  await user.click(screen.getByRole('button', { name: 'Create customer' }));
  await screen.findByText(/Creation may have completed/);
  expect(calls).toBe(1);
  expect(screen.getByRole('button', { name: 'Create customer' })).toBeDisabled();
});
it('updates with the exact quoted ETag and explicit reload after a concurrency conflict', async () => {
  let version = 3;
  const matches: (string | null)[] = [];
  server.use(
    http.get(`${base}/:id`, () => resource({ ...customer, version })),
    http.patch(`${base}/:id`, ({ request }) => {
      matches.push(request.headers.get('If-Match'));
      if (version === 3) {
        version = 4;
        return authFailure('CONCURRENT_MODIFICATION', 409);
      }
      return resource({ ...customer, version: 5 });
    }),
  );
  mount(`/${id}/edit`);
  await screen.findByDisplayValue('Acme');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText(/changed while you were editing/);
  expect(matches).toEqual(['"3"']);
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Reload current record (discard draft)' }));
  await screen.findByDisplayValue('Acme');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(matches).toEqual(['"3"', '"4"']));
});
it('confirms archive with focus/Escape behavior, empty POST and no version or key header', async () => {
  let archived = false;
  let calls = 0;
  server.use(
    http.get(`${base}/:id`, () =>
      resource({ ...customer, status: archived ? 'ARCHIVED' : 'ACTIVE' }),
    ),
    http.post(`${base}/:id/archive`, async ({ request }) => {
      calls++;
      expect(await request.json()).toEqual({});
      expect(request.headers.has('If-Match')).toBe(false);
      expect(request.headers.has('Idempotency-Key')).toBe(false);
      archived = true;
      return resource({ ...customer, status: 'ARCHIVED' });
    }),
  );
  mount(`/${id}`);
  const user = userEvent.setup();
  const trigger = await screen.findByRole('button', { name: 'Archive customer' });
  await user.click(trigger);
  let dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('button', { name: 'Cancel archive' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(calls).toBe(0);
  await user.click(trigger);
  dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Confirm archive' }));
  await screen.findByText(/This customer is archived/);
  expect(calls).toBe(1);
  expect(screen.queryByRole('button', { name: 'Archive customer' })).not.toBeInTheDocument();
});
it('leaves archived records readable and editable without offering restoration', async () => {
  server.use(http.get(`${base}/:id`, () => resource({ ...customer, status: 'ARCHIVED' })));
  mount(`/${id}`);
  await screen.findByText(/This customer is archived/);
  expect(screen.getByRole('link', { name: 'Edit customer' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Archive customer' })).not.toBeInTheDocument();
});
it('gates viewer write actions and a direct create route', async () => {
  const { router } = mount('', b.id);
  await screen.findByText('Beta customer');
  expect(screen.queryByRole('link', { name: 'Add customer' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Edit Beta customer' })).not.toBeInTheDocument();
  await router.navigate(path('/new', b.id));
  await screen.findByText(/Access denied. You do not have permission/);
});
it('switches from an old edit to the new tenant list and ignores late mutation completion', async () => {
  const gate = deferred();
  let started = false;
  server.use(
    http.patch(`${base}/:id`, async () => {
      started = true;
      await gate.promise;
      return resource();
    }),
  );
  const { router, query } = mount(`/${id}/edit`);
  await screen.findByDisplayValue('Acme');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(started).toBe(true));
  await user.selectOptions(screen.getByLabelText('Organization'), b.id);
  await screen.findByText('Beta customer');
  gate.resolve();
  await waitFor(() => expect(router.state.location.pathname).toBe(path('', b.id)));
  expect(screen.queryByDisplayValue('Acme')).not.toBeInTheDocument();
  expect(
    query
      .getQueryCache()
      .getAll()
      .some((q) => q.queryKey.includes(a.id) && q.queryKey.includes('customers')),
  ).toBe(false);
});
it('rejects cross-tenant response bodies, mismatched ETags and invalid page metadata', () => {
  expect(() => parseCustomer({ data: customer }, new Headers({ ETag: '"3"' }), b.id)).toThrow();
  expect(() => parseCustomer({ data: customer }, new Headers({ ETag: '3' }), a.id)).toThrow();
  expect(() =>
    parseCustomerList(
      { data: [customer], meta: { limit: 25, hasMore: true, nextCursor: null } },
      a.id,
      25,
      'ACTIVE',
    ),
  ).toThrow();
});
it('recovers from a network list failure with an explicit retry', async () => {
  server.use(http.get(base, () => HttpResponse.error()));
  mount();
  await screen.findByRole('heading', { name: 'Customers unavailable' }, { timeout: 4000 });
  server.use(http.get(base, ({ request }) => page(request)));
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry customer request' }));
  await screen.findByRole('link', { name: 'Acme' });
});
it('offers a fresh first page when a saved cursor becomes invalid', async () => {
  server.use(
    http.get(base, ({ request }) =>
      new URL(request.url).searchParams.has('after')
        ? authFailure('INVALID_CURSOR', 400)
        : page(request, [customer], 'returned_cursor'),
    ),
  );
  mount();
  await screen.findByRole('link', { name: 'Acme' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  await user.click(await screen.findByRole('button', { name: 'Restart pagination' }));
  await screen.findByText('Page 1');
});
it('does not automatically replay a create rejected with 401', async () => {
  let calls = 0;
  server.use(
    http.post(base, () => {
      calls++;
      return authFailure();
    }),
  );
  const { router } = mount('/new');
  await screen.findByRole('heading', { name: 'Add customer' });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Display name'), 'Acme');
  await user.click(screen.getByRole('button', { name: 'Create customer' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  expect(calls).toBe(1);
});
it.each([403, 409])('keeps archive failure %s safe and allows cancellation', async (status) => {
  server.use(
    http.post(`${base}/:id/archive`, () =>
      authFailure(status === 409 ? 'CONCURRENT_MODIFICATION' : 'FORBIDDEN', status),
    ),
  );
  mount(`/${id}`);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Archive customer' }));
  await user.click(screen.getByRole('button', { name: 'Confirm archive' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Private server text')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Cancel archive' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('prevents duplicate archive and handles an already-archived server response', async () => {
  const gate = deferred();
  let calls = 0;
  let archived = false;
  server.use(
    http.get(`${base}/:id`, () =>
      resource({ ...customer, status: archived ? 'ARCHIVED' : 'ACTIVE' }),
    ),
    http.post(`${base}/:id/archive`, async () => {
      calls++;
      await gate.promise;
      archived = true;
      return resource({ ...customer, status: 'ARCHIVED' });
    }),
  );
  mount(`/${id}`);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Archive customer' }));
  await user.dblClick(screen.getByRole('button', { name: 'Confirm archive' }));
  await waitFor(() => expect(calls).toBe(1));
  expect(screen.getByRole('button', { name: 'Archiving…' })).toBeDisabled();
  gate.resolve();
  await screen.findByText(/This customer is archived/);
});
it('cancels a late old-tenant list response and hides it after switching', async () => {
  const gate = deferred();
  let signal: AbortSignal | undefined;
  server.use(
    http.get(base, async ({ request, params }) => {
      if (params.org === a.id) {
        signal = request.signal;
        await gate.promise;
        return page(request);
      }
      return page(request, [{ ...customer, organizationId: b.id, displayName: 'Beta customer' }]);
    }),
  );
  mount();
  await screen.findByText('Loading customers…');
  await waitFor(() => expect(signal).toBeDefined());
  await userEvent.setup().selectOptions(screen.getByLabelText('Organization'), b.id);
  await screen.findByRole('link', { name: 'Beta customer' });
  await waitFor(() => expect(signal?.aborted).toBe(true));
  gate.resolve();
  expect(screen.queryByRole('link', { name: 'Acme' })).not.toBeInTheDocument();
});
it('validates bounded fields while preserving casing and whitespace and null-clears optional fields', () => {
  expect(customerPayload({ displayName: ' Acme ', customerCode: '', email: '' })).toEqual({
    displayName: ' Acme ',
    customerCode: null,
    email: null,
  });
  expect(
    customerFormSchema.safeParse({ displayName: 'x'.repeat(201), customerCode: '', email: '' })
      .success,
  ).toBe(false);
  expect(
    customerFormSchema.safeParse({ displayName: 'Acme', customerCode: 'x'.repeat(51), email: '' })
      .success,
  ).toBe(false);
  expect(
    customerFormSchema.safeParse({ displayName: 'Acme', customerCode: '', email: '', phone: 'bad' })
      .success,
  ).toBe(false);
});
