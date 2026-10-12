import { StrictMode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { createSession } from '../auth/session';
import { createQueryClient } from '../app/query-client';
import { routes } from '../routes/routes';
import { server } from '../test/server';
import {
  apiRoot,
  authFailure,
  authHandlers,
  deferred,
  testUser,
  tokenResponse,
} from '../test/auth-fixtures';
import { selectionKey } from './selection';
import { organizationKeys } from './query-keys';
import { PermissionBoundary } from './Workspace';

const a = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  legalName: 'Alpha Legal',
  displayName: 'Alpha',
  status: 'ACTIVE',
  baseCurrency: 'USD',
  timezone: 'UTC',
  membership: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', role: 'OWNER', status: 'ACTIVE' },
};
const b = {
  ...a,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  displayName: 'Beta',
  membership: { ...a.membership, role: 'VIEWER' },
};
const path = (id: string) => `/organizations/${id}/workspace`;
const disposers: (() => void)[] = [];
function mount(url = '/workspace', boundary?: string) {
  const query = createQueryClient();
  const session = createSession(query, apiRoot);
  const configured = boundary
    ? routes.map((r) =>
        r.children?.[0]?.element
          ? {
              ...r,
              children: r.children.map((child) =>
                child.children
                  ? {
                      ...child,
                      children: child.children.map((route) => ({
                        ...route,
                        element: (
                          <PermissionBoundary permission={boundary}>
                            <h1>Restricted content</h1>
                          </PermissionBoundary>
                        ),
                      })),
                    }
                  : child,
              ),
            }
          : r,
      )
    : routes;
  const router = createMemoryRouter(configured, { initialEntries: [url] });
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
  return { router, session, query };
}
beforeEach(() => {
  localStorage.clear();
  server.use(
    http.post(`${apiRoot}/auth/refresh`, () => HttpResponse.json(tokenResponse())),
    ...authHandlers(),
    http.get(`${apiRoot}/organizations`, () => HttpResponse.json({ data: [a, b] })),
    http.get(`${apiRoot}/organizations/:id`, ({ params }) =>
      HttpResponse.json({ data: params.id === a.id ? a : b }),
    ),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  disposers.splice(0).forEach((dispose) => dispose());
  localStorage.clear();
});

it('works when browser storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  mount();
  await screen.findByRole('heading', { name: 'Alpha' });
  await userEvent.selectOptions(screen.getByRole('combobox'), b.id);
  await screen.findByRole('heading', { name: 'Beta' });
});
it('uses the scoped URL ahead of a persisted hint and synchronizes browser history', async () => {
  localStorage.setItem(selectionKey(testUser.id), b.id);
  const { router } = mount(path(a.id));
  await screen.findByRole('heading', { name: 'Alpha' });
  await userEvent.selectOptions(screen.getByRole('combobox'), b.id);
  await screen.findByRole('heading', { name: 'Beta' });
  await act(async () => {
    await router.navigate(-1);
  });
  await screen.findByRole('heading', { name: 'Alpha' });
  expect(screen.getByRole('combobox')).toHaveValue(a.id);
});
it.each(['UNKNOWN', 'constructor'])('denies unknown resolved membership role %s', async (role) => {
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}`, () =>
      HttpResponse.json({ data: { ...a, membership: { ...a.membership, role } } }),
    ),
  );
  mount(path(a.id));
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  expect(screen.queryByText('Customers')).not.toBeInTheDocument();
});
it('denies an unknown permission even for an Owner', async () => {
  mount(path(a.id), 'unknown.permission');
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
});
it('conceals an inactive detail membership', async () => {
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}`, () =>
      HttpResponse.json({ data: { ...a, membership: { ...a.membership, status: 'SUSPENDED' } } }),
    ),
  );
  mount(path(a.id));
  await screen.findByRole('heading', { name: 'Organization unavailable' });
  expect(screen.queryByText('Customers')).not.toBeInTheDocument();
});

it('loads and verifies organizations before showing the scoped workspace', async () => {
  const pending = deferred();
  server.use(
    http.get(`${apiRoot}/organizations`, async () => {
      await pending.promise;
      return HttpResponse.json({ data: [a, b] });
    }),
  );
  const { router } = mount();
  expect(await screen.findByText('Checking organization access…')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Alpha' })).not.toBeInTheDocument();
  pending.resolve();
  expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe(path(a.id));
  expect(screen.getByRole('combobox', { name: 'Organization' })).toHaveValue(a.id);
  await waitFor(() => expect(localStorage.getItem(selectionKey(testUser.id))).toBe(a.id));
});
it('restores an account-specific selection only after fresh verification', async () => {
  localStorage.setItem(selectionKey(testUser.id), b.id);
  mount();
  expect(await screen.findByRole('heading', { name: 'Beta' })).toBeInTheDocument();
});
it.each(['invalid', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'])(
  'replaces invalid or revoked stored hints: %s',
  async (id) => {
    localStorage.setItem(selectionKey(testUser.id), id);
    mount();
    expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
  },
);
it('switches tenants, removes old scoped cache and hides forbidden future navigation', async () => {
  const { router, query } = mount();
  await screen.findByRole('heading', { name: 'Alpha' });
  query.setQueryData([...organizationKeys.scope(testUser.id, a.id), 'financial'], {
    private: 'Alpha data',
  });
  expect(screen.getByText('Payments')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole('combobox'), b.id);
  expect(await screen.findByRole('heading', { name: 'Beta' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe(path(b.id));
  expect(query.getQueriesData({ queryKey: organizationKeys.scope(testUser.id, a.id) })).toEqual([]);
  expect(screen.queryByText('Payments')).not.toBeInTheDocument();
  expect(screen.queryByText('Audit Logs')).not.toBeInTheDocument();
  expect(screen.getByText('Reports')).toHaveAttribute('aria-disabled', 'true');
  expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Cash Flow' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Expenses' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Invoices' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Customers' })).toBeInTheDocument();
});
it('cannot restore an old tenant from a delayed response after URL navigation', async () => {
  const pending = deferred();
  let started = false;
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}`, async () => {
      started = true;
      await pending.promise;
      return HttpResponse.json({ data: a });
    }),
  );
  const { router } = mount(path(a.id));
  await screen.findByText('Checking organization access…');
  await waitFor(() => expect(started).toBe(true));
  await act(async () => {
    await router.navigate(path(b.id));
  });
  await screen.findByRole('heading', { name: 'Beta' });
  pending.resolve();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(screen.queryByRole('heading', { name: 'Alpha' })).not.toBeInTheDocument();
  expect(screen.getByRole('combobox')).toHaveValue(b.id);
});

it('returns from sign-in to the intended scoped workspace', async () => {
  server.use(http.post(`${apiRoot}/auth/refresh`, () => authFailure('INVALID_SESSION')));
  const { router } = mount(path(b.id));
  await screen.findByRole('heading', { name: 'Sign in' });
  await userEvent.type(screen.getByLabelText('Email address'), testUser.email);
  await userEvent.type(screen.getByLabelText('Password'), 'a-private-password');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Beta' });
  expect(router.state.location.pathname).toBe(path(b.id));
});
it('does not substitute another tenant for an inaccessible scoped URL', async () => {
  const { router } = mount(path('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
  expect(
    await screen.findByRole('heading', { name: 'Organization unavailable' }),
  ).toBeInTheDocument();
  expect(router.state.location.pathname).toContain('cccccccc');
  expect(screen.queryByText('Customers')).not.toBeInTheDocument();
});
it.each([403, 404])(
  'conceals detail and permissions after backend access rejection %s without automatic retry',
  async (status) => {
    let requests = 0;
    server.use(
      http.get(`${apiRoot}/organizations/${a.id}`, () => {
        requests++;
        return authFailure('FORBIDDEN', status);
      }),
    );
    mount(path(a.id));
    await screen.findByRole('heading', {
      name: status === 403 ? 'Access denied' : 'Organization unavailable',
    });
    expect(screen.queryByText('Customers')).not.toBeInTheDocument();
    expect(requests).toBe(1);
  },
);
it('rechecks revoked membership and suppresses previously resolved hints', async () => {
  const { query } = mount();
  await screen.findByRole('heading', { name: 'Alpha' });
  server.use(http.get(`${apiRoot}/organizations/${a.id}`, () => authFailure('NOT_FOUND', 404)));
  await act(async () => {
    await query.refetchQueries({ queryKey: organizationKeys.context(testUser.id, a.id) });
  });
  await screen.findByRole('heading', { name: 'Organization unavailable' });
  expect(screen.queryByText('Customers')).not.toBeInTheDocument();
});
it('shows a distinct empty membership state', async () => {
  server.use(http.get(`${apiRoot}/organizations`, () => HttpResponse.json({ data: [] })));
  mount();
  await screen.findByRole('heading', { name: 'No organizations yet' });
  expect(screen.getByRole('combobox')).toBeDisabled();
});
it('shows a safe API error and supports explicit retry', async () => {
  server.use(http.get(`${apiRoot}/organizations`, () => authFailure('INTERNAL_ERROR', 500)));
  mount();
  await screen.findByRole('heading', { name: 'Unable to load organizations' });
  expect(screen.queryByText('Private server text')).not.toBeInTheDocument();
  server.use(http.get(`${apiRoot}/organizations`, () => HttpResponse.json({ data: [a] })));
  await userEvent.click(screen.getByRole('button', { name: 'Retry access check' }));
  await screen.findByRole('heading', { name: 'Alpha' });
});
it('rejects a detail response for a different tenant', async () => {
  server.use(http.get(`${apiRoot}/organizations/${a.id}`, () => HttpResponse.json({ data: b })));
  mount(path(a.id));
  await screen.findByRole('heading', { name: 'Unable to load organizations' });
  expect(screen.queryByText('Customers')).not.toBeInTheDocument();
});
it('keeps every organization from the unpaginated listing selectable', async () => {
  const many = Array.from({ length: 80 }, (_, i) => ({
    ...a,
    id: `${i.toString(16).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    displayName: `Company ${i}`,
  }));
  server.use(
    http.get(`${apiRoot}/organizations`, () => HttpResponse.json({ data: many })),
    http.get(`${apiRoot}/organizations/:id`, ({ params }) =>
      HttpResponse.json({ data: many.find((o) => o.id === params.id) }),
    ),
  );
  mount();
  await screen.findByRole('heading', { name: 'Company 0' });
  expect(screen.getAllByRole('option')).toHaveLength(81);
  await userEvent.selectOptions(screen.getByLabelText('Organization'), many[79]!.id);
  await screen.findByRole('heading', { name: 'Company 79' });
});
it('traps mobile drawer focus, closes with Escape and returns focus to its trigger', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Alpha' });
  const trigger = screen.getByRole('button', { name: 'Open navigation' });
  await userEvent.click(trigger);
  const close = screen.getByRole('button', { name: 'Close navigation' });
  expect(screen.getByRole('dialog', { name: 'SME Finance' })).toBeInTheDocument();
  expect(close).toHaveFocus();
  await userEvent.tab({ shift: true });
  expect(screen.getByRole('link', { name: 'Workspace' })).toHaveFocus();
  await userEvent.tab();
  expect(close).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
it('denies a permission-sensitive route without confusing it with initial loading', async () => {
  mount(path(b.id), 'payment.read');
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  expect(screen.queryByRole('heading', { name: 'Restricted content' })).not.toBeInTheDocument();
});
it('clears selection and sensitive caches on logout', async () => {
  const { query } = mount();
  await screen.findByRole('heading', { name: 'Alpha' });
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByRole('heading', { name: 'Sign in' });
  expect(localStorage.getItem(selectionKey(testUser.id))).toBeNull();
  expect(query.getQueriesData({ queryKey: ['organization'] })).toEqual([]);
});
it('isolates a new account from the previous account selection and data', async () => {
  const { session, router, query } = mount();
  await screen.findByRole('heading', { name: 'Alpha' });
  const otherUser = { ...testUser, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
  server.use(
    http.post(`${apiRoot}/auth/login`, () =>
      HttpResponse.json({ data: { ...tokenResponse().data, user: otherUser } }),
    ),
    http.get(`${apiRoot}/me`, () => HttpResponse.json({ data: otherUser })),
    http.get(`${apiRoot}/organizations`, () => HttpResponse.json({ data: [b] })),
  );
  await act(async () => {
    await session.login({ email: otherUser.email, password: 'a-private-password' });
    await router.navigate('/workspace');
  });
  await screen.findByRole('heading', { name: 'Beta' });
  expect(query.getQueriesData({ queryKey: organizationKeys.list(testUser.id) })).toEqual([]);
  expect(localStorage.getItem(selectionKey(otherUser.id))).toBe(b.id);
});
