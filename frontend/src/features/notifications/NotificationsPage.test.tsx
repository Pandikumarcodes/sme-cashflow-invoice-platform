import { StrictMode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AuthProvider } from '../../auth/AuthProvider';
import { AuthContext } from '../../auth/AuthContext';
import { createSession } from '../../auth/session';
import { createQueryClient } from '../../app/query-client';
import { routes } from '../../routes/routes';
import {
  OrganizationContext,
  type OrganizationContextValue,
} from '../../organizations/OrganizationContext';
import type { Organization } from '../../organizations/contracts';
import { server } from '../../test/server';
import {
  apiRoot,
  authHandlers,
  authFailure,
  tokenResponse,
  deferred as makeDeferred,
  testUser,
} from '../../test/auth-fixtures';
import { dashboardOrg as a, secondOrg as b } from '../dashboard/test-fixtures';
import {
  notification,
  notificationPage,
  readNotification,
  notificationId,
  invoiceId,
  instant,
} from './test-fixtures';
import { defaultFilters, type Notification } from './contracts';
import { notificationKeys } from './queries';
import { NotificationsPage } from './NotificationsPage';
const root = `${apiRoot}/organizations/:org/notifications`;
const path = (id = a.id) => `/organizations/${id}/notifications`;
const disposers: (() => void)[] = [];
const gates: (() => void)[] = [];
const deferred = () => {
  const gate = makeDeferred();
  gates.push(gate.resolve);
  return gate;
};
let rows: Notification[];
let reads: URL[];
let writes: { path: string; body: unknown; headers: Headers }[];
function mount(url = path()) {
  const query = createQueryClient();
  const session = createSession(query, apiRoot);
  const router = createMemoryRouter(routes, { initialEntries: [url] });
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
  return { query, router, session };
}
function ready() {
  return screen.findByRole('list', { name: 'Notification inbox' }, { timeout: 4000 });
}
beforeEach(() => {
  localStorage.clear();
  rows = [notification(), readNotification()];
  reads = [];
  writes = [];
  server.use(
    http.post(`${apiRoot}/auth/refresh`, () => HttpResponse.json(tokenResponse())),
    ...authHandlers(),
    http.get(`${apiRoot}/organizations`, () => HttpResponse.json({ data: [a, b] })),
    http.get(`${apiRoot}/organizations/:id`, ({ params }) =>
      HttpResponse.json({ data: params.id === a.id ? a : b }),
    ),
    http.get(root, ({ params, request }) => {
      const url = new URL(request.url);
      reads.push(url);
      const status = url.searchParams.get('status');
      let page = rows.filter(
        (row) =>
          row.organizationId === params.org &&
          (status ? row.status === status : row.status !== 'ARCHIVED'),
      );
      page = [...page].sort(
        (first, second) =>
          Date.parse(second.createdAt) - Date.parse(first.createdAt) ||
          second.id.localeCompare(first.id),
      );
      if (url.searchParams.get('sortOrder') === 'asc') page.reverse();
      return HttpResponse.json(notificationPage(page, Number(url.searchParams.get('limit'))));
    }),
    ...(['read', 'archive'] as const).map((action) =>
      http.post(`${root}/:id/${action}`, async ({ params, request }) => {
        writes.push({
          path: new URL(request.url).pathname,
          body: await request.json(),
          headers: request.headers,
        });
        const row = rows.find((row) => row.id === params.id && row.organizationId === params.org);
        if (!row) return authFailure('NOT_FOUND', 404);
        if (action === 'archive' && row.status !== 'ARCHIVED') {
          row.status = 'ARCHIVED';
          row.archivedAt = instant;
        }
        if (action === 'read' && row.status === 'UNREAD') {
          row.status = 'READ';
          row.readAt = instant;
        }
        return HttpResponse.json({ data: row });
      }),
    ),
  );
});
afterEach(() => {
  cleanup();
  gates.splice(0).forEach((release) => release());
  disposers.splice(0).forEach((dispose) => dispose());
  localStorage.clear();
});
it('renders unread/read states, exact times, structured links and the constrained page count', async () => {
  mount();
  const list = await ready();
  expect(within(list).getByText('Unread')).toBeInTheDocument();
  expect(within(list).getByText('Read')).toBeInTheDocument();
  expect(screen.getByText('Unread on this page: 1. Loaded notifications: 2.')).toBeInTheDocument();
  const reminder = screen.getByRole('article', { name: 'Invoice overdue' });
  expect(within(reminder).getByText('Invoice overdue reminder')).toBeInTheDocument();
  expect(within(reminder).getByText('Unread', { exact: true })).toBeVisible();
  expect(within(reminder).getByRole('heading', { name: 'Invoice overdue' })).toBeVisible();
  expect(within(reminder).getByRole('link', { name: 'Open related invoice' })).toHaveAttribute(
    'href',
    `/organizations/${a.id}/invoices/${invoiceId}`,
  );
  expect(reminder.querySelector('time')?.getAttribute('datetime')).toBe(instant);
  expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(screen.queryByText(/99\+/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', {
      name: /mark.*unread|send reminder|retry reminder|schedule reminder/i,
    }),
  ).not.toBeInTheDocument();
});
it('sends the exact default read contract and scoped key', async () => {
  const { query } = mount();
  await ready();
  expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({
    limit: '25',
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  expect(reads.at(-1)!.pathname).toBe(`/api/v1/organizations/${a.id}/notifications`);
  expect(
    query.getQueryState(notificationKeys.list(testUser.id, a.id, defaultFilters)),
  ).toBeDefined();
});
it.each(['UNREAD', 'READ', 'ARCHIVED'] as const)('uses the supported %s filter', async (status) => {
  if (status === 'ARCHIVED')
    rows.push(
      notification({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
        status: 'ARCHIVED',
        archivedAt: instant,
        createdAt: '2026-10-10T10:00:00.000Z',
        title: 'Archived activity',
      }),
    );
  mount();
  await ready();
  await userEvent.selectOptions(screen.getByLabelText('Notification state'), status);
  const list = await ready();
  expect(reads.at(-1)!.searchParams.get('status')).toBe(status);
  expect(within(list).getAllByRole('article')).toHaveLength(1);
});
it('supports order, page size and explicit refresh without an invented type filter', async () => {
  mount();
  await ready();
  await userEvent.selectOptions(screen.getByLabelText('Created order'), 'asc');
  await ready();
  expect(reads.at(-1)!.searchParams.get('sortOrder')).toBe('asc');
  await userEvent.selectOptions(screen.getByLabelText('Notifications per page'), '50');
  await ready();
  expect(reads.at(-1)!.searchParams.get('limit')).toBe('50');
  const count = reads.length;
  await userEvent.click(screen.getByRole('button', { name: 'Refresh inbox' }));
  await ready();
  expect(reads.length).toBeGreaterThan(count);
  expect(screen.queryByLabelText('Notification type')).not.toBeInTheDocument();
});
it('uses opaque next/previous cursors and resets pagination after filters', async () => {
  const first = Array.from({ length: 25 }, (_, index) =>
    notification({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      createdAt: new Date(Date.parse(instant) - index * 1000).toISOString(),
      title: `First page ${index}`,
    }),
  );
  server.use(
    http.get(root, ({ request }) => {
      const url = new URL(request.url);
      reads.push(url);
      const limit = Number(url.searchParams.get('limit'));
      return HttpResponse.json(
        notificationPage(
          url.searchParams.has('after') ? [notification({ title: 'Second page' })] : first,
          limit,
          url.searchParams.has('after') ? null : 'opaque_next_page',
        ),
      );
    }),
  );
  mount();
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Next notifications' }));
  await screen.findByRole('heading', { name: 'Second page' });
  expect(reads.at(-1)!.searchParams.get('after')).toBe('opaque_next_page');
  await userEvent.click(screen.getByRole('button', { name: 'Previous notifications' }));
  await screen.findByRole('heading', { name: 'First page 0' });
  expect(reads.at(-1)!.searchParams.has('after')).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Next notifications' }));
  await ready();
  await userEvent.selectOptions(screen.getByLabelText('Notification state'), 'UNREAD');
  await ready();
  expect(reads.at(-1)!.searchParams.has('after')).toBe(false);
  expect(screen.getByText('Page 1')).toBeInTheDocument();
});
it.each([
  ['', 'You’re all caught up'],
  ['UNREAD', 'No unread notifications'],
  ['READ', 'No read notifications'],
  ['ARCHIVED', 'No archived notifications'],
])('renders the %s empty state', async (status, title) => {
  rows = [];
  mount();
  await ready();
  if (status) {
    await userEvent.selectOptions(screen.getByLabelText('Notification state'), status);
    await ready();
  }
  expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  expect(screen.getByText('Unread on this page: 0. Loaded notifications: 0.')).toBeInTheDocument();
});
it('shows loading withholds data and provides a safe retry after failure', async () => {
  const gate = deferred();
  const started = deferred();
  server.use(
    http.get(root, async () => {
      started.resolve();
      await gate.promise;
      return authFailure('FORBIDDEN', 403);
    }),
  );
  mount();
  await started.promise;
  expect(screen.getByText('Loading notifications…')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Notification inbox' })).not.toBeInTheDocument();
  gate.resolve();
  expect(await screen.findByRole('alert')).not.toHaveTextContent('Private server text');
  expect(screen.getByRole('button', { name: 'Retry notifications' })).toBeInTheDocument();
  server.use(http.get(root, () => HttpResponse.json(notificationPage(rows))));
  await userEvent.click(screen.getByRole('button', { name: 'Retry notifications' }));
  await ready();
});
it('restarts after a rejected cursor', async () => {
  const first = Array.from({ length: 25 }, (_, index) =>
    notification({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      createdAt: new Date(Date.parse(instant) - index * 1000).toISOString(),
    }),
  );
  server.use(
    http.get(root, ({ request }) =>
      new URL(request.url).searchParams.has('after')
        ? authFailure('INVALID_CURSOR', 400)
        : HttpResponse.json(notificationPage(first, 25, 'opaque_next')),
    ),
  );
  mount();
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Next notifications' }));
  await screen.findByRole('button', { name: 'Restart notification list' });
  await userEvent.click(screen.getByRole('button', { name: 'Restart notification list' }));
  await ready();
  expect(screen.getByText('Page 1')).toBeInTheDocument();
});
it('marks read once with the exact empty command and invalidates notification-only scopes', async () => {
  const gate = deferred();
  const started = deferred();
  server.use(
    http.post(`${root}/:id/read`, async ({ request }) => {
      writes.push({
        path: new URL(request.url).pathname,
        body: await request.json(),
        headers: request.headers,
      });
      started.resolve();
      await gate.promise;
      rows[0]!.status = 'READ';
      rows[0]!.readAt = instant;
      return HttpResponse.json({ data: rows[0] });
    }),
  );
  const { query } = mount();
  await ready();
  const scopes = ['', 'UNREAD', 'READ', 'ARCHIVED'].map((status) => [
    ...notificationKeys.scope(testUser.id, a.id),
    status,
    'sentinel',
  ]);
  const others = [
    [...notificationKeys.scope(testUser.id, b.id), 'sentinel'],
    ['organization', testUser.id, a.id, 'invoices', 'sentinel'],
    ['organization', testUser.id, a.id, 'cash-flow', 'sentinel'],
  ];
  for (const key of [...scopes, ...others]) query.setQueryData(key, {});
  await userEvent.dblClick(screen.getByRole('button', { name: 'Mark Invoice overdue as read' }));
  await started.promise;
  expect(screen.getByRole('button', { name: 'Mark Invoice overdue as read' })).toBeDisabled();
  expect(writes).toHaveLength(1);
  gate.resolve();
  await screen.findByText('Notification marked as read.');
  await ready();
  expect(screen.getByText('Unread on this page: 0. Loaded notifications: 2.')).toBeInTheDocument();
  expect(writes[0]!.path).toBe(
    `/api/v1/organizations/${a.id}/notifications/${notificationId}/read`,
  );
  expect(writes[0]!.body).toEqual({});
  expect(writes[0]!.headers.has('If-Match')).toBe(false);
  expect(writes[0]!.headers.has('Idempotency-Key')).toBe(false);
  for (const key of scopes) expect(query.getQueryState(key)?.isInvalidated).toBe(true);
  for (const key of others) expect(query.getQueryState(key)?.isInvalidated).toBe(false);
});
it('removes a confirmed read from the unread filter using authoritative refetch', async () => {
  mount();
  await ready();
  await userEvent.selectOptions(screen.getByLabelText('Notification state'), 'UNREAD');
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Mark Invoice overdue as read' }));
  await screen.findByRole('heading', { name: 'No unread notifications' });
  expect(screen.getByText('Unread on this page: 0. Loaded notifications: 0.')).toBeInTheDocument();
});
it('confirms terminal archive and offers no restoration or unread action', async () => {
  mount();
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Archive Invoice overdue' }));
  expect(screen.getByRole('button', { name: 'Confirm archive Invoice overdue' })).toHaveFocus();
  expect(writes).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Keep in inbox' }));
  expect(screen.getByRole('button', { name: 'Archive Invoice overdue' })).toHaveFocus();
  expect(writes).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Archive Invoice overdue' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm archive Invoice overdue' }));
  await screen.findByText('Notification archived.');
  await ready();
  expect(writes[0]!.path).toContain(`/${notificationId}/archive`);
  expect(writes[0]!.body).toEqual({});
  await userEvent.selectOptions(screen.getByLabelText('Notification state'), 'ARCHIVED');
  await ready();
  const item = screen.getByRole('article', { name: 'Invoice overdue' });
  expect(within(item).getByText('Archived')).toBeInTheDocument();
  expect(within(item).queryByRole('button')).not.toBeInTheDocument();
});
it.each([403, 404, 409, 422, 500])(
  'handles mutation %s without automatic replay or optimistic state',
  async (status) => {
    let calls = 0;
    server.use(
      http.post(`${root}/:id/read`, () => {
        calls++;
        return authFailure('NOTIFICATION_UNAVAILABLE', status);
      }),
    );
    mount();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Mark Invoice overdue as read' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('Private server text');
    expect(calls).toBe(1);
    expect(
      screen.getByText('Unread on this page: 1. Loaded notifications: 2.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Invoice overdue as read' })).toBeEnabled();
  },
);
it('offers repeat-safe explicit retry after an uncertain command', async () => {
  let calls = 0;
  server.use(
    http.post(`${root}/:id/read`, () => {
      calls++;
      if (calls === 1) return HttpResponse.error();
      rows[0]!.status = 'READ';
      rows[0]!.readAt = instant;
      return HttpResponse.json({ data: rows[0] });
    }),
  );
  mount();
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Mark Invoice overdue as read' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('repeat-safe');
  await userEvent.click(screen.getByRole('button', { name: 'Mark Invoice overdue as read' }));
  await screen.findByText('Notification marked as read.');
  expect(calls).toBe(2);
});
it('keeps report/internal/unknown notifications readable without invented destinations', async () => {
  rows = [
    notification({
      type: 'REPORT_READY',
      relatedEntityType: 'ReportExport',
      title: 'Report ready',
    }),
    readNotification({
      type: 'NEW_TYPE',
      title: 'New activity',
      relatedEntityType: 'ReminderDelivery',
    }),
  ];
  mount();
  await ready();
  expect(screen.getByText('Activity')).toBeInTheDocument();
  expect(
    within(screen.getByRole('list', { name: 'Notification inbox' })).queryByRole('link'),
  ).not.toBeInTheDocument();
});
it('navigates using the invoice reference without marking read implicitly', async () => {
  server.use(
    http.get(`${apiRoot}/organizations/:org/invoices/:id`, () => authFailure('NOT_FOUND', 404)),
  );
  const { router } = mount();
  await ready();
  await userEvent.click(screen.getByRole('link', { name: 'Open related invoice' }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/organizations/${a.id}/invoices/${invoiceId}`),
  );
  expect(writes).toHaveLength(0);
});
it('recovers a GET authentication expiry through the existing session flow', async () => {
  let refreshes = 0;
  server.use(
    http.post(`${apiRoot}/auth/refresh`, () =>
      HttpResponse.json(
        tokenResponse(++refreshes === 1 ? 'initial-test-token' : 'renewed-test-token'),
      ),
    ),
    http.get(root, ({ request }) =>
      request.headers.get('Authorization') === 'Bearer initial-test-token'
        ? authFailure()
        : HttpResponse.json(notificationPage(rows)),
    ),
  );
  mount();
  await ready();
  expect(refreshes).toBe(2);
  expect(screen.getByRole('article', { name: 'Invoice overdue' })).toBeInTheDocument();
});
it('cancels an obsolete filtered page before displaying a different filter', async () => {
  const gate = deferred();
  const started = deferred();
  let aborted = false;
  server.use(
    http.get(root, async ({ request }) => {
      const status = new URL(request.url).searchParams.get('status');
      if (status === 'UNREAD') {
        request.signal.addEventListener('abort', () => {
          aborted = true;
        });
        started.resolve();
        await gate.promise;
      }
      return HttpResponse.json(
        notificationPage(status ? rows.filter((row) => row.status === status) : rows),
      );
    }),
  );
  mount();
  await ready();
  await userEvent.selectOptions(screen.getByLabelText('Notification state'), 'UNREAD');
  await started.promise;
  expect(screen.queryByRole('list', { name: 'Notification inbox' })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Notification state'), 'READ');
  await ready();
  gate.resolve();
  expect(aborted).toBe(true);
  expect(screen.getByRole('article', { name: 'Payment recorded' })).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByRole('article', { name: 'Invoice overdue' })).not.toBeInTheDocument(),
  );
});
it('a later account cannot reuse the previous recipient inbox cache', async () => {
  const { query, router, session } = mount();
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByRole('heading', { name: 'Sign in' });
  const nextUser = {
    ...testUser,
    id: '99999999-9999-4999-8999-999999999999',
    email: 'next@example.test',
  };
  server.use(
    http.post(`${apiRoot}/auth/login`, () =>
      HttpResponse.json({ data: { ...tokenResponse().data, user: nextUser } }),
    ),
    http.get(`${apiRoot}/me`, () => HttpResponse.json({ data: nextUser })),
    http.get(root, () =>
      HttpResponse.json(notificationPage([readNotification({ title: 'Next recipient inbox' })])),
    ),
  );
  await userEvent.type(screen.getByLabelText('Email address'), nextUser.email);
  await userEvent.type(screen.getByLabelText('Password'), 'a-private-password');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(session.getSnapshot().status).toBe('authenticated'));
  await act(() => router.navigate(path()));
  await ready();
  expect(screen.getByRole('article', { name: 'Next recipient inbox' })).toBeInTheDocument();
  expect(screen.queryByRole('article', { name: 'Invoice overdue' })).not.toBeInTheDocument();
  expect(
    query
      .getQueryCache()
      .getAll()
      .some((q) => q.queryKey[0] === 'organization' && q.queryKey[1] === testUser.id),
  ).toBe(false);
  expect(
    query.getQueryState(notificationKeys.list(nextUser.id, a.id, defaultFilters)),
  ).toBeDefined();
});
it('does not invent mutation replay headers when authentication expires', async () => {
  let calls = 0;
  server.use(
    http.post(`${root}/:id/read`, () => {
      calls++;
      return authFailure();
    }),
  );
  const { query } = mount();
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Mark Invoice overdue as read' }));
  await screen.findByRole('heading', { name: 'Sign in' });
  expect(calls).toBe(1);
  expect(
    query
      .getQueryCache()
      .getAll()
      .some((q) => q.queryKey[0] === 'organization'),
  ).toBe(false);
});
it('withholds malformed successful inbox data and provides safe recovery', async () => {
  server.use(
    http.get(root, () =>
      HttpResponse.json({
        data: [{ ...notification(), organizationId: b.id }],
        meta: { limit: 25, hasMore: false, nextCursor: null },
      }),
    ),
  );
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be verified');
  expect(screen.queryByRole('list', { name: 'Notification inbox' })).not.toBeInTheDocument();
});
it('withholds and aborts old-tenant rows and counts during a switch', async () => {
  const gate = deferred();
  const started = deferred();
  let obsolete = false;
  let aborted = false;
  server.use(
    http.get(root, async ({ params, request }) => {
      reads.push(new URL(request.url));
      if (params.org === a.id && obsolete) {
        request.signal.addEventListener('abort', () => {
          aborted = true;
        });
        started.resolve();
        await gate.promise;
      }
      return HttpResponse.json(
        notificationPage(
          params.org === a.id
            ? rows
            : [readNotification({ organizationId: b.id, title: 'Beta inbox' })],
        ),
      );
    }),
  );
  const { query, router } = mount();
  await ready();
  obsolete = true;
  await userEvent.click(screen.getByRole('button', { name: 'Refresh inbox' }));
  await started.promise;
  expect(screen.queryByRole('article', { name: 'Invoice overdue' })).not.toBeInTheDocument();
  expect(
    screen.queryByText('Unread on this page: 1. Loaded notifications: 2.'),
  ).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Organization'), b.id);
  await ready();
  expect(router.state.location.pathname).toBe(path(b.id));
  expect(screen.getByRole('heading', { name: 'Beta inbox' })).toBeInTheDocument();
  expect(screen.getByText('Unread on this page: 0. Loaded notifications: 1.')).toBeInTheDocument();
  expect(aborted).toBe(true);
  expect(
    query
      .getQueryCache()
      .getAll()
      .filter((q) => q.queryKey[0] === 'organization' && q.queryKey[2] === a.id),
  ).toHaveLength(0);
  gate.resolve();
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'Invoice overdue' })).not.toBeInTheDocument(),
  );
});
it('aborts a pending command on tenant switch and ignores its late receipt', async () => {
  const gate = deferred();
  const started = deferred();
  let aborted = false;
  rows.push(readNotification({ organizationId: b.id, title: 'Beta notification' }));
  server.use(
    http.post(`${root}/:id/read`, async ({ request }) => {
      request.signal.addEventListener('abort', () => {
        aborted = true;
      });
      started.resolve();
      await gate.promise;
      return HttpResponse.json({ data: notification({ status: 'READ', readAt: instant }) });
    }),
  );
  mount();
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Mark Invoice overdue as read' }));
  await started.promise;
  await userEvent.selectOptions(screen.getByLabelText('Organization'), b.id);
  await ready();
  gate.resolve();
  expect(aborted).toBe(true);
  expect(screen.queryByText('Notification marked as read.')).not.toBeInTheDocument();
});
it('clears notification caches on logout', async () => {
  const { query } = mount();
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByRole('heading', { name: 'Sign in' });
  expect(
    query
      .getQueryCache()
      .getAll()
      .some((q) => q.queryKey[0] === 'organization'),
  ).toBe(false);
  expect(screen.queryByRole('list', { name: 'Notification inbox' })).not.toBeInTheDocument();
});
it('allows read-only permissions without assuming an invented role', async () => {
  const query = createQueryClient();
  const session = createSession(query, apiRoot);
  await session.restore();
  const org = a as Organization;
  const context: OrganizationContextValue = {
    status: 'ready',
    organizations: [org],
    selectedId: a.id,
    organization: org,
    membership: org.membership,
    permissions: ['notification.read'],
    hasPermission: (p) => p === 'notification.read',
    switchOrganization: () => {},
    activateCreatedOrganization: async () => {},
    retry: () => {},
    clearSelection: () => {},
  };
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <OrganizationContext.Provider value={context}>
          <NotificationsPage />
        </OrganizationContext.Provider>
      ),
    },
  ]);
  render(
    <QueryClientProvider client={query}>
      <AuthContext.Provider
        value={{ status: 'authenticated', busy: false, user: testUser, session }}
      >
        <RouterProvider router={router} />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  disposers.push(() => {
    router.dispose();
    query.clear();
  });
  await ready();
  expect(screen.queryByRole('button', { name: /archive|mark.*as read/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open related invoice' })).not.toBeInTheDocument();
});
it('denies unknown membership permissions before making inbox calls', async () => {
  const org = { ...a, membership: { ...a.membership, role: 'UNKNOWN' } };
  server.use(
    http.get(`${apiRoot}/organizations`, () => HttpResponse.json({ data: [org] })),
    http.get(`${apiRoot}/organizations/:id`, () => HttpResponse.json({ data: org })),
  );
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  expect(reads).toHaveLength(0);
  expect(screen.queryByRole('link', { name: 'Notifications' })).not.toBeInTheDocument();
});
