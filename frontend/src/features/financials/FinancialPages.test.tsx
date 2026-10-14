import { StrictMode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
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
  tokenResponse,
  deferred,
  testUser,
} from '../../test/auth-fixtures';
import { dashboardOrg as a, secondOrg as b } from '../dashboard/test-fixtures';
import { localToday, presetRange } from '../dashboard/dates';
import { cashReport, profitReport, agingReport } from './test-fixtures';
import { type CashGrouping, type ProfitGrouping } from './contracts';
import { financialKeys } from './query-keys';
const disposers: (() => void)[] = [];
beforeAll(async () => {
  await import('./FinancialPages');
});
const gates: (() => void)[] = [];
let requested: URL[] = [];
const path = (kind = 'cash-flow', id = a.id) => `/organizations/${id}/${kind}`;
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
const ready = () =>
  screen.findByRole('region', { name: 'Financial report summary' }, { timeout: 4000 });
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
    ...(['cash-flow', 'profit-loss'] as const).map((kind) =>
      http.get(`${apiRoot}/organizations/:id/${kind}`, ({ request }) => {
        const url = new URL(request.url);
        requested.push(url);
        const period = {
          fromDate: url.searchParams.get('fromDate')!,
          toDate: url.searchParams.get('toDate')!,
        };
        return HttpResponse.json(
          kind === 'cash-flow'
            ? cashReport(period, url.searchParams.get('groupBy') as CashGrouping)
            : profitReport(period, url.searchParams.get('groupBy') as ProfitGrouping),
        );
      }),
    ),
    http.get(`${apiRoot}/organizations/:id/analytics/receivables-aging`, ({ request }) => {
      const url = new URL(request.url);
      requested.push(url);
      return HttpResponse.json(agingReport(url.searchParams.get('asOfDate')!));
    }),
  );
});
afterEach(() => {
  cleanup();
  gates.splice(0).forEach((release) => release());
  disposers.splice(0).forEach((dispose) => dispose());
  vi.unstubAllGlobals();
  localStorage.clear();
});
it('renders exact cash totals, negative net, chart and accessible table', async () => {
  const { router } = mount();
  await routerReady(router);
  const summary = await ready();
  expect(within(summary).getByText(/12,345,678,901,234,567,890.10/)).toBeInTheDocument();
  expect(within(summary).getByText(/-\$10.15/)).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Exact cash values (USD)' })).toBeInTheDocument();
  expect(
    screen.getByRole('img', { name: 'Cash inflow and outflow by period' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Cash Flow' })).toHaveAttribute('aria-current', 'page');
});
it.each(['day', 'week', 'month'] as const)(
  'requests supported cash %s grouping only',
  async (group) => {
    mount(
      `${path()}?fromDate=2024-02-14&toDate=2024-03-10&groupBy=${group}&asOfDate=1999-01-01&unsupported=yes`,
    );
    await ready();
    expect(Object.fromEntries(requested.at(-1)!.searchParams)).toEqual({
      fromDate: '2024-02-14',
      toDate: '2024-03-10',
      groupBy: group,
    });
  },
);
it('uses organization-local month defaults and canonical shared Dashboard cash key', async () => {
  const { query } = mount();
  await ready();
  const range = presetRange('current-month', localToday('UTC'));
  expect(
    query.getQueryState(financialKeys.cash(testUser.id, a.id, 'USD', 'UTC', range, 'month')),
  ).toBeDefined();
  expect(requested.at(-1)!.searchParams.get('fromDate')).toBe(range.fromDate);
});
it('validates range before sending and supports URL grouping and back navigation', async () => {
  const { router } = mount();
  await ready();
  const before = requested.length;
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2024-01-01' } });
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2025-01-01' } });
  await userEvent.click(screen.getByRole('button', { name: 'Apply report period' }));
  expect(screen.getByRole('alert')).toHaveTextContent('366');
  expect(requested).toHaveLength(before);
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2024-12-31' } });
  await userEvent.click(screen.getByRole('button', { name: 'Apply report period' }));
  await ready();
  expect(router.state.location.search).toContain('2024-12-31');
  await userEvent.selectOptions(screen.getByLabelText('Group financial report by'), 'week');
  await ready();
  expect(requested.at(-1)!.searchParams.get('groupBy')).toBe('week');
  await act(() => router.navigate(-1));
  await ready();
  expect(screen.getByLabelText('Group financial report by')).toHaveValue('month');
});
it.each(['cash-flow', 'profit-loss'])(
  'blocks invalid URL dates and grouping for %s',
  async (kind) => {
    mount(`${path(kind)}?fromDate=2024-02-30&toDate=2024-03-10&groupBy=unsupported`);
    expect(await screen.findByRole('alert')).toHaveTextContent('calendar');
    expect(requested).toHaveLength(0);
  },
);
it.each(['month', 'none'] as const)(
  'renders cash-basis P&L with %s contract and category breakdown',
  async (group) => {
    mount(`${path('profit-loss')}?groupBy=${group}`);
    const summary = await ready();
    expect(within(summary).getByText(/-\$100.15/)).toBeInTheDocument();
    expect(screen.getByText('Archived rent')).toBeInTheDocument();
    expect(screen.getByText('Not a GAAP/IFRS financial statement.')).toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: 'Exact expense category values (USD)' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('table', { name: 'Exact monthly cash-basis performance (USD)' }),
    ).toEqual(group === 'month' ? expect.anything() : null);
  },
);
it('renders five exact aging buckets with independent as-of query and current-state disclosure', async () => {
  mount(`${path('receivables-aging')}?asOfDate=2024-03-10&fromDate=invalid&groupBy=day`);
  await ready();
  expect(Object.fromEntries(requested.at(-1)!.searchParams)).toEqual({ asOfDate: '2024-03-10' });
  const table = screen.getByRole('table', { name: 'Exact aging bucket values (USD)' });
  expect(within(table).getAllByRole('row')).toHaveLength(6);
  expect(screen.getByText(/not a frozen historical snapshot/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Receivables as-of date'), {
    target: { value: '2028-01-01' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Apply as-of date' }));
  await ready();
  expect(Object.fromEntries(requested.at(-1)!.searchParams)).toEqual({ asOfDate: '2028-01-01' });
});
it('blocks invalid aging dates without sending a read', async () => {
  mount(`${path('receivables-aging')}?asOfDate=2024-02-30`);
  expect(await screen.findByRole('alert')).toHaveTextContent('valid as-of');
  expect(requested).toHaveLength(0);
});
it.each(['cash-flow', 'profit-loss', 'receivables-aging'])(
  'denies analytics permission for %s before any financial read',
  async (kind) => {
    const org = { ...a, membership: { ...a.membership, role: 'MEMBER' } };
    server.use(
      http.get(`${apiRoot}/organizations`, () => HttpResponse.json({ data: [org] })),
      http.get(`${apiRoot}/organizations/:id`, () => HttpResponse.json({ data: org })),
    );
    mount(path(kind));
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
    expect(requested).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Cash Flow' })).not.toBeInTheDocument();
  },
);
it.each([403, 404, 409, 422, 500])(
  'safely displays %s and permits an explicit retry',
  async (status) => {
    let failing = true;
    server.use(
      http.get(`${apiRoot}/organizations/:id/cash-flow`, ({ request }) =>
        failing
          ? authFailure('FINANCIAL_UNAVAILABLE', status)
          : HttpResponse.json(
              cashReport({
                fromDate: new URL(request.url).searchParams.get('fromDate')!,
                toDate: new URL(request.url).searchParams.get('toDate')!,
              }),
            ),
      ),
    );
    mount();
    expect(
      await screen.findByRole('button', { name: 'Retry financial report' }, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Financial report summary' }),
    ).not.toBeInTheDocument();
    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry financial report' }));
    await ready();
  },
);
it('renders empty reports without filled periods or invented totals', async () => {
  server.use(
    http.get(`${apiRoot}/organizations/:id/cash-flow`, ({ request }) => {
      const url = new URL(request.url);
      const body = cashReport({
        fromDate: url.searchParams.get('fromDate')!,
        toDate: url.searchParams.get('toDate')!,
      });
      body.data = { inflows: '0.00', outflows: '0.00', netCashFlow: '0.00', series: [] };
      return HttpResponse.json(body);
    }),
  );
  mount();
  await ready();
  expect(screen.getByText('No populated periods in this range.')).toBeInTheDocument();
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(1);
});
it('withholds stale totals and cancels pending financial reads on organization switch', async () => {
  const gate = deferred();
  const started = deferred();
  gates.push(gate.resolve);
  let aborted = false;
  server.use(
    http.get(`${apiRoot}/organizations/:id/cash-flow`, async ({ params, request }) => {
      const url = new URL(request.url);
      const body = cashReport({
        fromDate: url.searchParams.get('fromDate')!,
        toDate: url.searchParams.get('toDate')!,
      });
      if (params.id === a.id) {
        request.signal.addEventListener('abort', () => {
          aborted = true;
        });
        started.resolve();
        await gate.promise;
      } else {
        body.data.inflows = '99.00';
        body.data.series[0]!.inflows = '99.00';
      }
      return HttpResponse.json(body);
    }),
  );
  const { query } = mount();
  await started.promise;
  expect(
    screen.queryByRole('region', { name: 'Financial report summary' }),
  ).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Organization'), b.id);
  await ready();
  expect(
    within(screen.getByRole('region', { name: 'Financial report summary' })).getByText(/99.00/),
  ).toBeInTheDocument();
  expect(aborted).toBe(true);
  expect(
    query
      .getQueryCache()
      .getAll()
      .filter((q) => q.queryKey[0] === 'organization' && q.queryKey[2] === a.id),
  ).toHaveLength(0);
  gate.resolve();
  await waitFor(() => expect(screen.queryByText(/12,345,678/)).not.toBeInTheDocument());
});
it('displays empty aging with all five zero backend buckets', async () => {
  server.use(
    http.get(`${apiRoot}/organizations/:id/analytics/receivables-aging`, ({ request }) => {
      const body = agingReport(new URL(request.url).searchParams.get('asOfDate')!);
      body.data.outstanding = '0.00';
      body.data.overdue = '0.00';
      body.data.buckets.forEach((row) => {
        row.amount = '0.00';
        row.invoiceCount = 0;
      });
      return HttpResponse.json(body);
    }),
  );
  mount(path('receivables-aging'));
  await ready();
  expect(screen.getByText('No outstanding receivables as of this date.')).toBeInTheDocument();
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(6);
});
it('displays empty P&L without an invented category or period', async () => {
  server.use(
    http.get(`${apiRoot}/organizations/:id/profit-loss`, ({ request }) => {
      const url = new URL(request.url);
      const body = profitReport({
        fromDate: url.searchParams.get('fromDate')!,
        toDate: url.searchParams.get('toDate')!,
      });
      body.data = {
        revenue: '0.00',
        expenses: '0.00',
        netResult: '0.00',
        expenseByCategory: [],
        series: [],
      };
      return HttpResponse.json(body);
    }),
  );
  mount(path('profit-loss'));
  await ready();
  expect(screen.getByText('No active expense amounts in this range.')).toBeInTheDocument();
  expect(screen.getByText('No populated periods in this range.')).toBeInTheDocument();
});
it('withholds unverifiable financial responses with a safe retry state', async () => {
  server.use(
    http.get(`${apiRoot}/organizations/:id/profit-loss`, () =>
      HttpResponse.json({ data: { revenue: 100 }, meta: {} }),
    ),
  );
  mount(path('profit-loss'));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be verified');
  expect(
    screen.queryByRole('region', { name: 'Financial report summary' }),
  ).not.toBeInTheDocument();
});
it('aborts an obsolete filter read and withholds its late response', async () => {
  const gate = deferred();
  const started = deferred();
  gates.push(gate.resolve);
  let aborted = false;
  server.use(
    http.get(`${apiRoot}/organizations/:id/cash-flow`, async ({ request }) => {
      const url = new URL(request.url);
      const group = url.searchParams.get('groupBy') as CashGrouping;
      const body = cashReport(
        { fromDate: url.searchParams.get('fromDate')!, toDate: url.searchParams.get('toDate')! },
        group,
      );
      if (group === 'week') {
        request.signal.addEventListener('abort', () => {
          aborted = true;
        });
        started.resolve();
        await gate.promise;
        body.data.inflows = '88.00';
      }
      return HttpResponse.json(body);
    }),
  );
  mount();
  await ready();
  await userEvent.selectOptions(screen.getByLabelText('Group financial report by'), 'week');
  await started.promise;
  expect(
    screen.queryByRole('region', { name: 'Financial report summary' }),
  ).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Group financial report by'), 'day');
  await ready();
  expect(aborted).toBe(true);
  gate.resolve();
  await waitFor(() => expect(screen.queryByText(/88.00/)).not.toBeInTheDocument());
});
it('removes scoped financial data on account logout', async () => {
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
  expect(
    screen.queryByRole('region', { name: 'Financial report summary' }),
  ).not.toBeInTheDocument();
});
