import { StrictMode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import './DashboardPage';
import { AuthProvider } from '../../auth/AuthProvider';
import { createSession } from '../../auth/session';
import { createQueryClient } from '../../app/query-client';
import { routes } from '../../routes/routes';
import { server } from '../../test/server';
import { routerReady } from '../../test/router-ready';
import {
  apiRoot,
  authFailure,
  authHandlers,
  deferred as makeDeferred,
  testUser,
  tokenResponse,
} from '../../test/auth-fixtures';
import { organizationKeys } from '../../organizations/query-keys';
import { safeReturnTo } from '../../auth/return-to';
import { localToday, presetRange, type DateRange } from './dates';
import { cashFixture, dashboardOrg as a, secondOrg as b, summaryFixture } from './test-fixtures';
import { financialKeys } from '../financials/query-keys';
const disposers: (() => void)[] = [];
const gates: (() => void)[] = [];
function deferred() {
  const gate = makeDeferred();
  gates.push(gate.resolve);
  return gate;
}
const dashboardPath = (id: string) => `/organizations/${id}/dashboard`;
const today = () => localToday('UTC');
const rangeFrom = (request: Request): DateRange => {
  const url = new URL(request.url);
  return {
    fromDate: url.searchParams.get('fromDate')!,
    toDate: url.searchParams.get('toDate')!,
    asOfDate: url.searchParams.get('asOfDate') ?? today(),
  };
};
let requested: URL[] = [];
function mount(path = dashboardPath(a.id)) {
  const query = createQueryClient();
  const session = createSession(query, apiRoot);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
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
  return { router, query, session };
}
async function ready() {
  return screen.findByRole('region', { name: 'Financial summary' }, { timeout: 4000 });
}
beforeEach(() => {
  localStorage.clear();
  requested = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  server.use(
    http.post(`${apiRoot}/auth/refresh`, () => HttpResponse.json(tokenResponse())),
    ...authHandlers(),
    http.get(`${apiRoot}/organizations`, () => HttpResponse.json({ data: [a, b] })),
    http.get(`${apiRoot}/organizations/:id`, ({ params }) =>
      HttpResponse.json({ data: params.id === a.id ? a : b }),
    ),
    http.get(`${apiRoot}/organizations/:id/analytics/summary`, ({ request }) => {
      requested.push(new URL(request.url));
      return HttpResponse.json(summaryFixture(rangeFrom(request)));
    }),
    http.get(`${apiRoot}/organizations/:id/cash-flow`, ({ request }) => {
      requested.push(new URL(request.url));
      return HttpResponse.json(cashFixture(rangeFrom(request)));
    }),
  );
});
afterEach(() => {
  cleanup();
  gates.splice(0).forEach((release) => release());
  disposers.splice(0).forEach((dispose) => dispose());
  localStorage.clear();
  vi.unstubAllGlobals();
});
it('renders the lazy dashboard, authoritative cards, disclosure and exact chart table', async () => {
  const { router } = mount();
  await routerReady(router);
  const summary = await ready();
  expect(screen.getByRole('heading', { name: 'Financial overview' })).toBeInTheDocument();
  expect(within(summary).getByText('$1,200.10')).toBeInTheDocument();
  expect(within(summary).getByText('$799.90')).toBeInTheDocument();
  expect(screen.getByText(/Not a GAAP\/IFRS financial statement/)).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Cash inflow versus outflow' })).toBeInTheDocument();
  expect(
    screen.getByRole('table', { name: 'Exact monthly cash values (USD)' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Workspace' })).not.toHaveAttribute('aria-current');
});
it('sends only supported financial filters and includes account, tenant and range in cache keys', async () => {
  const { query } = mount();
  await ready();
  const range = presetRange('current-month', today());
  // StrictMode may cancel an initial pair of GETs; only these two endpoint/filter URLs are used.
  expect(new Set(requested.map((url) => url.href)).size).toBe(2);
  const summary = requested.find((url) => url.pathname.endsWith('/summary'))!;
  expect(summary.pathname).toContain(a.id);
  expect(Object.fromEntries(summary.searchParams)).toEqual(range);
  const cash = requested.find((url) => url.pathname.endsWith('/cash-flow'))!;
  expect(Object.fromEntries(cash.searchParams)).toEqual({
    fromDate: range.fromDate,
    toDate: range.toDate,
    groupBy: 'month',
  });
  const keys = query
    .getQueryCache()
    .getAll()
    .map((q) => q.queryKey);
  expect(keys).toContainEqual([
    ...organizationKeys.scope(testUser.id, a.id),
    'dashboard',
    'USD',
    'UTC',
    range.fromDate,
    range.toDate,
    today(),
    'month',
  ]);
  expect(keys).toContainEqual(financialKeys.cash(testUser.id, a.id, 'USD', 'UTC', range, 'month'));
});
it.each(['previous-month', 'last-90-days'] as const)(
  'refetches with the %s business-date preset and leaves receivables as-of unchanged',
  async (preset) => {
    mount();
    await ready();
    await userEvent.selectOptions(screen.getByLabelText('Date range'), preset);
    await ready();
    const range = presetRange(preset, today());
    expect(
      Object.fromEntries(
        requested.filter((url) => url.pathname.endsWith('/summary')).at(-1)!.searchParams,
      ),
    ).toEqual(range);
  },
);
it('validates custom ranges before sending requests and applies valid dates', async () => {
  mount();
  await ready();
  await userEvent.selectOptions(screen.getByLabelText('Date range'), 'custom');
  const count = requested.length;
  await userEvent.clear(screen.getByLabelText('From date'));
  await userEvent.type(screen.getByLabelText('From date'), '2024-01-01');
  await userEvent.clear(screen.getByLabelText('To date'));
  await userEvent.type(screen.getByLabelText('To date'), '2025-01-01');
  await userEvent.click(screen.getByRole('button', { name: 'Apply range' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('366');
  expect(requested).toHaveLength(count);
  await userEvent.clear(screen.getByLabelText('To date'));
  await userEvent.type(screen.getByLabelText('To date'), '2024-12-31');
  await userEvent.click(screen.getByRole('button', { name: 'Apply range' }));
  await ready();
  expect(requested.at(-1)?.searchParams.get('toDate')).toBe('2024-12-31');
});
it('withholds amounts while a financial request is pending', async () => {
  const pending = deferred();
  const started = deferred();
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}/analytics/summary`, async ({ request }) => {
      started.resolve();
      await pending.promise;
      return HttpResponse.json(summaryFixture(rangeFrom(request)));
    }),
  );
  mount();
  await started.promise;
  await screen.findByText('Loading financial overview…');
  expect(screen.queryByRole('region', { name: 'Financial summary' })).not.toBeInTheDocument();
  pending.resolve();
  await ready();
});
it('shows zero cards and an empty chart without fabricated periods', async () => {
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}/analytics/summary`, ({ request }) => {
      const response = summaryFixture(rangeFrom(request), '0.00', '0.00');
      response.data.billing.totalInvoiced = '0.00';
      response.data.receivables = { outstanding: '0.00', overdue: '0.00' };
      response.data.cash = { netCashFlow: '0.00', netResult: '0.00' };
      return HttpResponse.json(response);
    }),
    http.get(`${apiRoot}/organizations/${a.id}/cash-flow`, ({ request }) => {
      const response = cashFixture(rangeFrom(request), '0.00', '0.00');
      response.data.series = [];
      return HttpResponse.json(response);
    }),
  );
  mount();
  await ready();
  expect(screen.getByText('No cash activity in this range.')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
it.each([403, 404, 422])(
  'handles financial rejection %s safely without automatic retries',
  async (status) => {
    const attempts: Request[] = [];
    server.use(
      http.get(`${apiRoot}/organizations/${a.id}/analytics/summary`, ({ request }) => {
        attempts.push(request);
        return authFailure('FORBIDDEN', status);
      }),
    );
    mount();
    await screen.findByRole('alert');
    expect(attempts.filter((request) => !request.signal.aborted)).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Financial summary' })).not.toBeInTheDocument();
    expect(screen.queryByText('Private server text')).not.toBeInTheDocument();
  },
);
it('bounds server read retries and supports explicit recovery', async () => {
  const attempts: Request[] = [];
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}/analytics/summary`, ({ request }) => {
      attempts.push(request);
      return authFailure('UNAVAILABLE', 500);
    }),
  );
  mount();
  await screen.findByRole('alert', {}, { timeout: 4000 });
  expect(attempts.filter((request) => !request.signal.aborted)).toHaveLength(2);
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}/analytics/summary`, ({ request }) =>
      HttpResponse.json(summaryFixture(rangeFrom(request))),
    ),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Retry financial overview' }));
  await ready();
});
it('never requests financial data for a member without analytics.read', async () => {
  const member = { ...a, membership: { ...a.membership, role: 'MEMBER' } };
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}`, () => HttpResponse.json({ data: member })),
  );
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  expect(requested).toEqual([]);
  expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
});
it('preserves the dashboard route on switching while canceling old tenant data and late responses', async () => {
  const pending = deferred();
  let started = false;
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}/analytics/summary`, async ({ request }) => {
      started = true;
      await pending.promise;
      return HttpResponse.json(summaryFixture(rangeFrom(request), '9999.99'));
    }),
    http.get(`${apiRoot}/organizations/${b.id}/analytics/summary`, ({ request }) =>
      HttpResponse.json(summaryFixture(rangeFrom(request), '777.77')),
    ),
  );
  const { router, query } = mount();
  await waitFor(() => expect(started).toBe(true));
  await userEvent.selectOptions(screen.getByLabelText('Organization'), b.id);
  const summary = await ready();
  expect(router.state.location.pathname).toBe(dashboardPath(b.id));
  expect(within(summary).getByText('$777.77')).toBeInTheDocument();
  pending.resolve();
  await act(async () => {
    await new Promise((done) => setTimeout(done, 20));
  });
  expect(screen.queryByText('$9,999.99')).not.toBeInTheDocument();
  expect(query.getQueriesData({ queryKey: organizationKeys.scope(testUser.id, a.id) })).toEqual([]);
});
it('keeps dashboard reads off unrelated workspace routes and allows safe dashboard return-to', async () => {
  mount(`/organizations/${a.id}/workspace`);
  await screen.findByRole('heading', { name: 'Alpha' });
  expect(requested).toEqual([]);
  expect(safeReturnTo(dashboardPath(a.id))).toBe(dashboardPath(a.id));
  await userEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
  await ready();
});

it('recovers a canonical access 401 once through the existing session controller', async () => {
  let refreshes = 0;
  server.use(
    http.post(`${apiRoot}/auth/refresh`, () =>
      HttpResponse.json(tokenResponse(`access-${++refreshes}`)),
    ),
    http.get(`${apiRoot}/organizations/${a.id}/analytics/summary`, ({ request }) =>
      request.headers.get('Authorization') === 'Bearer access-1'
        ? authFailure('UNAUTHENTICATED')
        : HttpResponse.json(summaryFixture(rangeFrom(request))),
    ),
  );
  mount();
  await ready();
  expect(refreshes).toBe(2);
});
it('withholds financial data when membership revalidation removes analytics permission', async () => {
  const { query } = mount();
  await ready();
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}`, () =>
      HttpResponse.json({ data: { ...a, membership: { ...a.membership, role: 'MEMBER' } } }),
    ),
  );
  await act(async () => {
    await query.refetchQueries({ queryKey: organizationKeys.context(testUser.id, a.id) });
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  expect(screen.queryByRole('region', { name: 'Financial summary' })).not.toBeInTheDocument();
});
it('prevents a delayed previous-filter response from replacing a new filter', async () => {
  const pending = deferred();
  let started = false;
  const current = presetRange('current-month', today());
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}/analytics/summary`, async ({ request }) => {
      const range = rangeFrom(request);
      if (range.fromDate === current.fromDate) {
        started = true;
        await pending.promise;
        return HttpResponse.json(summaryFixture(range, '9999.99'));
      }
      return HttpResponse.json(summaryFixture(range, '777.77'));
    }),
  );
  mount();
  await waitFor(() => expect(started).toBe(true));
  await userEvent.selectOptions(screen.getByLabelText('Date range'), 'previous-month');
  expect(within(await ready()).getByText('$777.77')).toBeInTheDocument();
  pending.resolve();
  await act(async () => {
    await new Promise((done) => setTimeout(done, 20));
  });
  expect(screen.queryByText('$9,999.99')).not.toBeInTheDocument();
});
