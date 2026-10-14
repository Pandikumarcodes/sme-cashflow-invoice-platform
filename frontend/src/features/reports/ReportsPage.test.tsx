import { StrictMode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import './ReportsPage';
import '../audit/AuditLogsPage';
import { AuthProvider } from '../../auth/AuthProvider';
import { createSession } from '../../auth/session';
import { createQueryClient } from '../../app/query-client';
import { routes } from '../../routes/routes';
import { server } from '../../test/server';
import {
  apiRoot,
  authHandlers,
  tokenResponse,
  authFailure,
  deferred,
  testUser,
} from '../../test/auth-fixtures';
import { dashboardOrg as a, secondOrg as b } from '../dashboard/test-fixtures';
import { exportFixture, exportId, page, auditFixture, instant } from './test-fixtures';
import { reportTypes, type ReportExport, defaultExportFilters } from './contracts';
import { reportKeys } from './queries';
import { auditKeys } from '../audit/queries';
import { defaultFilters } from '../audit/contracts';
const root = `${apiRoot}/organizations/:org`;
const disposers: (() => void)[] = [];
const gates: (() => void)[] = [];
let reads: URL[], writes: { body: Record<string, unknown>; headers: Headers }[], row: ReportExport;
function mount(area = 'reports', org = a.id, suffix = '') {
  const query = createQueryClient(),
    session = createSession(query, apiRoot);
  const router = createMemoryRouter(routes, {
    initialEntries: [`/organizations/${org}/${area}${suffix}`],
  });
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
  return { query, session, router };
}
beforeEach(() => {
  localStorage.clear();
  reads = [];
  writes = [];
  row = exportFixture();
  server.use(
    http.post(`${apiRoot}/auth/refresh`, () => HttpResponse.json(tokenResponse())),
    ...authHandlers(),
    http.get(`${apiRoot}/organizations`, () => HttpResponse.json({ data: [a, b] })),
    http.get(`${apiRoot}/organizations/:id`, ({ params }) =>
      HttpResponse.json({ data: params.id === a.id ? a : b }),
    ),
    http.get(`${root}/report-exports`, ({ request, params }) => {
      reads.push(new URL(request.url));
      return HttpResponse.json(page(params.org === a.id ? [row] : []));
    }),
    http.get(`${root}/report-exports/:id`, ({ request }) => {
      reads.push(new URL(request.url));
      return HttpResponse.json({ data: row });
    }),
    http.post(`${root}/reports/exports`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      writes.push({ body, headers: request.headers });
      row = exportFixture({
        reportType: body.reportType as ReportExport['reportType'],
        parameters: body.parameters as Record<string, string>,
      });
      return HttpResponse.json({ data: row }, { status: 202 });
    }),
    http.get(`${root}/reports/:type`, ({ request }) => {
      const url = new URL(request.url);
      reads.push(url);
      return HttpResponse.json({
        data: [],
        meta: {
          ...page([]).meta,
          ...Object.fromEntries(
            [...url.searchParams].filter(([key]) => !['limit', 'after'].includes(key)),
          ),
          currency: 'USD',
          timezone: 'UTC',
          basis: 'CURRENT_STATE',
        },
      });
    }),
    http.get(`${root}/audit-logs`, ({ request }) => {
      reads.push(new URL(request.url));
      return HttpResponse.json(page([auditFixture()]));
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
  gates.splice(0).forEach((release) => release());
  disposers.splice(0).forEach((dispose) => dispose());
  localStorage.clear();
});
const ready = () => screen.findByRole('region', { name: 'Export history' }, { timeout: 4000 });
it('renders real Reports navigation, exact scoped history contract and no polling', async () => {
  const { query } = mount();
  await ready();
  await screen.findByText('PENDING');
  expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
  expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({ limit: '25' });
  expect(
    query.getQueryState(reportKeys.exports(testUser.id, a.id, defaultExportFilters)),
  ).toBeDefined();
  expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
});
it.each(reportTypes)(
  'requests %s with CSV, exact parameters and an idempotency key',
  async (type) => {
    mount();
    await ready();
    await userEvent.selectOptions(screen.getByLabelText('Export report type'), type);
    await userEvent.click(screen.getByRole('button', { name: 'Request CSV export' }));
    await screen.findByRole('region', { name: 'Export status' });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.body).toMatchObject({ reportType: type, format: 'CSV' });
    expect(writes[0]!.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(writes[0]!.headers.has('If-Match')).toBe(false);
    const parameters = writes[0]!.body.parameters as Record<string, string>;
    expect(Object.keys(parameters).sort()).toEqual(
      type === 'RECEIVABLES'
        ? ['asOfDate']
        : [
            'fromDate',
            'toDate',
            ...(type === 'INVOICE_REGISTER' ? ['asOfDate'] : []),
            ...(['CASH_FLOW', 'CASH_BASIS_PERFORMANCE'].includes(type) ? ['groupBy'] : []),
          ].sort(),
    );
  },
);
it('blocks invalid UUID filters before a POST', async () => {
  mount();
  await ready();
  await userEvent.type(screen.getByLabelText('Customer ID (optional)'), 'bad');
  await userEvent.click(screen.getByRole('button', { name: 'Request CSV export' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Check report');
  expect(writes).toHaveLength(0);
});
it('freezes an uncertain request and explicitly retries the identical payload/key', async () => {
  server.use(
    http.post(`${root}/reports/exports`, async ({ request }) => {
      writes.push({
        body: (await request.json()) as Record<string, unknown>,
        headers: request.headers,
      });
      if (writes.length === 1) return HttpResponse.error();
      row = exportFixture({ parameters: writes[0]!.body.parameters as Record<string, string> });
      return HttpResponse.json({ data: row }, { status: 202 });
    }),
  );
  mount();
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Request CSV export' }));
  await screen.findByText(/Outcome unconfirmed/);
  expect(screen.getByLabelText('Export report type')).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Retry same export request' }));
  await screen.findByRole('region', { name: 'Export status' });
  expect(writes).toHaveLength(2);
  expect(writes[1]!.body).toEqual(writes[0]!.body);
  expect(writes[1]!.headers.get('Idempotency-Key')).toBe(writes[0]!.headers.get('Idempotency-Key'));
});
it('disables duplicate submissions while a command is pending', async () => {
  const gate = deferred();
  gates.push(gate.resolve);
  server.use(
    http.post(`${root}/reports/exports`, async ({ request }) => {
      writes.push({
        body: (await request.json()) as Record<string, unknown>,
        headers: request.headers,
      });
      await gate.promise;
      return HttpResponse.json(
        {
          data: exportFixture({ parameters: writes[0]!.body.parameters as Record<string, string> }),
        },
        { status: 202 },
      );
    }),
  );
  mount();
  await ready();
  await userEvent.dblClick(screen.getByRole('button', { name: 'Request CSV export' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(screen.getByLabelText('Export report type')).toBeDisabled();
  await act(async () => {
    gate.resolve();
  });
  await screen.findByRole('region', { name: 'Export status' });
});
it.each(['PENDING', 'RUNNING', 'FAILED', 'EXPIRED'] as const)(
  'withholds download for %s',
  async (status) => {
    row = exportFixture({
      status,
      ...(status === 'EXPIRED' ? { completedAt: instant, expiresAt: instant, rowCount: '1' } : {}),
      ...(status === 'FAILED' ? { errorCode: 'REPORT_TOO_LARGE' } : {}),
    });
    mount('reports', a.id, `?exportId=${exportId}`);
    await screen.findByRole('region', { name: 'Export status' });
    await waitFor(() => expect(reads.some((url) => url.pathname.endsWith(exportId))).toBe(true));
    await screen.findAllByText(status);
    expect(screen.queryByRole('button', { name: /Download selected/ })).not.toBeInTheDocument();
  },
);
it('refreshes metadata manually and handles a download expiry error safely', async () => {
  row = exportFixture({ status: 'READY', completedAt: instant, expiresAt: instant, rowCount: '1' });
  server.use(
    http.get(`${root}/report-exports/:id/download`, () => authFailure('EXPORT_EXPIRED', 409)),
  );
  mount('reports', a.id, `?exportId=${exportId}`);
  await screen.findByRole('button', { name: 'Download selected CSV' });
  await userEvent.click(screen.getByRole('button', { name: 'Download selected CSV' }));
  await screen.findByText('Export expired. Refresh its metadata.');
  row = exportFixture({
    status: 'EXPIRED',
    completedAt: instant,
    expiresAt: instant,
    rowCount: '1',
  });
  await userEvent.click(screen.getByRole('button', { name: 'Refresh export status' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Download selected CSV' })).not.toBeInTheDocument(),
  );
});
it.each(['INVOICE_REGISTER', 'PAYMENT_REGISTER', 'EXPENSE_REGISTER', 'RECEIVABLES'] as const)(
  'uses the supported %s preview endpoint and normalized filters',
  async (type) => {
    mount();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Preview reports' }));
    await screen.findByRole('region', { name: 'Report preview' });
    await userEvent.selectOptions(screen.getByLabelText('Preview report type'), type);
    await screen.findByText('No report rows in this selection.');
    const paths = {
      INVOICE_REGISTER: 'invoices',
      PAYMENT_REGISTER: 'payments',
      EXPENSE_REGISTER: 'expenses',
      RECEIVABLES: 'receivables',
    };
    await waitFor(() =>
      expect(reads.at(-1)!.pathname).toBe(`/api/v1/organizations/${a.id}/reports/${paths[type]}`),
    );
    expect(reads.at(-1)!.searchParams.get('limit')).toBe('25');
    expect(reads.at(-1)!.searchParams.has('asOfDate')).toBe(
      ['INVOICE_REGISTER', 'RECEIVABLES'].includes(type),
    );
  },
);
it('conceals forbidden audit navigation and sends no audit request for Viewer', async () => {
  mount('audit-logs', b.id);
  await screen.findByText(/Access denied/);
  expect(screen.queryByRole('link', { name: 'Audit Logs' })).not.toBeInTheDocument();
  expect(reads.filter((url) => url.pathname.endsWith('audit-logs'))).toHaveLength(0);
});
it('withholds all Reports controls for a membership without report permissions', async () => {
  const member = { ...a, membership: { ...a.membership, role: 'MEMBER' } };
  server.use(
    http.get(`${apiRoot}/organizations`, () => HttpResponse.json({ data: [member] })),
    http.get(`${apiRoot}/organizations/:id`, () => HttpResponse.json({ data: member })),
  );
  mount();
  await screen.findByText(/Access denied/);
  expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Request CSV export' })).not.toBeInTheDocument();
  expect(reads).toHaveLength(0);
  expect(writes).toHaveLength(0);
});
it('renders read-only audit details, opaque actors and safe related resource links', async () => {
  const { query } = mount('audit-logs');
  const list = await screen.findByRole('list', { name: 'Audit history' });
  expect(within(list).getByRole('link', { name: 'Open related resource' })).toHaveAttribute(
    'href',
    `/organizations/${a.id}/invoices/${exportId}`,
  );
  expect(within(list).getByText('invoice.issued')).toBeInTheDocument();
  expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({
    limit: '25',
    sortBy: 'occurredAt',
    sortOrder: 'desc',
  });
  expect(query.getQueryState(auditKeys.list(testUser.id, a.id, defaultFilters))).toBeDefined();
  expect(
    screen.queryByRole('button', { name: /delete|edit|export audit/i }),
  ).not.toBeInTheDocument();
});
it('applies exact audit filters and ordering, without fetching actor profiles or a detail endpoint', async () => {
  mount('audit-logs');
  await screen.findByRole('list', { name: 'Audit history' });
  await userEvent.type(screen.getByLabelText('Exact action'), 'invoice.issued');
  await userEvent.selectOptions(screen.getByLabelText('Audit order'), 'asc');
  await userEvent.click(screen.getByRole('button', { name: 'Apply audit filters' }));
  await waitFor(() => expect(reads.at(-1)!.searchParams.get('action')).toBe('invoice.issued'));
  expect(reads.at(-1)!.searchParams.get('sortOrder')).toBe('asc');
  expect(reads.every((url) => url.pathname.endsWith('/audit-logs'))).toBe(true);
});
it('blocks invalid audit filter UUIDs before changing the query', async () => {
  mount('audit-logs');
  await screen.findByRole('list', { name: 'Audit history' });
  const count = reads.length;
  await userEvent.type(screen.getByLabelText('Entity ID'), 'bad');
  await userEvent.click(screen.getByRole('button', { name: 'Apply audit filters' }));
  await screen.findByText('Enter valid actor/entity UUIDs.');
  expect(reads).toHaveLength(count);
});
it('rejects forged tenant export metadata instead of rendering it', async () => {
  row = exportFixture({ organizationId: b.id });
  mount();
  await screen.findByText('The report response could not be verified.');
  expect(screen.queryByText(exportId)).not.toBeInTheDocument();
});
it('removes old-organization exports on navigation and namespaces account caches', async () => {
  const { router } = mount();
  await ready();
  await screen.findByText(exportId);
  await act(async () => {
    await router.navigate(`/organizations/${b.id}/reports`);
  });
  await screen.findByText('No exports available yet.');
  expect(screen.queryByText(exportId)).not.toBeInTheDocument();
  expect(reportKeys.scope('account-a', a.id)).not.toEqual(reportKeys.scope('account-b', a.id));
  expect(auditKeys.scope('account-a', a.id)).not.toEqual(auditKeys.scope('account-b', a.id));
});
it('downloads the authenticated server bytes without rebuilding or caching CSV contents', async () => {
  row = exportFixture({ status: 'READY', completedAt: instant, expiresAt: instant, rowCount: '1' });
  const csv = 'name,amount\r\nÉlodie,10.01\r\n';
  const create = vi.fn(() => 'blob:download'),
    revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe(`report-${exportId}.csv`);
  });
  let headers: Headers | undefined;
  server.use(
    http.get(`${root}/report-exports/:id/download`, ({ request }) => {
      reads.push(new URL(request.url));
      headers = request.headers;
      return new HttpResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
    }),
  );
  const { query } = mount();
  await ready();
  await userEvent.click(await screen.findByRole('button', { name: `Download CSV ${exportId}` }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(await (create.mock.calls[0] as unknown as [Blob])[0].text()).toBe(csv);
  expect(headers?.get('Authorization')).toBe('Bearer memory-access-token');
  expect(reads.at(-1)!.pathname).toBe(
    `/api/v1/organizations/${a.id}/report-exports/${exportId}/download`,
  );
  expect(reads.at(-1)!.search).toBe('');
  expect(
    query
      .getQueryCache()
      .getAll()
      .some((q) => q.state.data instanceof Blob),
  ).toBe(false);
  expect(document.querySelector('a[download]')).toBeNull();
  await userEvent.selectOptions(screen.getByLabelText('Organization'), b.id);
  await screen.findByText('No exports available yet.');
  expect(revoke).toHaveBeenCalledOnce();
});
it('aborts an obsolete organization response and prevents late metadata or download controls', async () => {
  const gate = deferred(),
    started = deferred();
  gates.push(gate.resolve, started.resolve);
  let delayed = false,
    aborted = false;
  server.use(
    http.get(`${root}/report-exports`, async ({ request, params }) => {
      reads.push(new URL(request.url));
      if (params.org === a.id && delayed) {
        request.signal.addEventListener('abort', () => {
          aborted = true;
        });
        started.resolve();
        await gate.promise;
      }
      return HttpResponse.json(page(params.org === a.id ? [row] : []));
    }),
  );
  const { query } = mount();
  await ready();
  await screen.findByText(exportId);
  delayed = true;
  await userEvent.click(screen.getByRole('button', { name: 'Refresh export history' }));
  await started.promise;
  expect(screen.queryByText(exportId)).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Organization'), b.id);
  await screen.findByText('No exports available yet.');
  expect(aborted).toBe(true);
  expect(reads.at(-1)!.pathname).toContain(b.id);
  await act(async () => {
    gate.resolve();
  });
  expect(screen.queryByText(exportId)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Download CSV/ })).not.toBeInTheDocument();
  expect(
    query
      .getQueryCache()
      .getAll()
      .filter((q) => q.queryKey[0] === 'organization' && q.queryKey[2] === a.id),
  ).toHaveLength(0);
});
it('aborts a pending download on tenant switch without creating a stale blob URL', async () => {
  row = exportFixture({ status: 'READY', completedAt: instant, expiresAt: instant, rowCount: '1' });
  const gate = deferred(),
    started = deferred();
  gates.push(gate.resolve, started.resolve);
  let aborted = false;
  const create = vi.fn(() => 'blob:late');
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = vi.fn();
    },
  );
  server.use(
    http.get(`${root}/report-exports/:id/download`, async ({ request }) => {
      request.signal.addEventListener('abort', () => {
        aborted = true;
      });
      started.resolve();
      await gate.promise;
      return new HttpResponse('amount\r\n10.01\r\n', { headers: { 'Content-Type': 'text/csv' } });
    }),
  );
  mount();
  await ready();
  await userEvent.click(await screen.findByRole('button', { name: `Download CSV ${exportId}` }));
  await started.promise;
  await userEvent.selectOptions(screen.getByLabelText('Organization'), b.id);
  await screen.findByText('No exports available yet.');
  await act(async () => {
    gate.resolve();
  });
  expect(aborted).toBe(true);
  expect(create).not.toHaveBeenCalled();
});
it.each(['reports', 'audit-logs'])(
  'clears sensitive %s state on logout and isolates a later account',
  async (area) => {
    const { query, session, router } = mount(area);
    if (area === 'reports') {
      await ready();
      await screen.findByText(exportId);
    } else await screen.findByRole('list', { name: 'Audit history' });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByText(exportId)).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Audit history' })).not.toBeInTheDocument();
    expect(
      query
        .getQueryCache()
        .getAll()
        .some((q) => q.queryKey[0] === 'organization'),
    ).toBe(false);
    const later = { ...testUser, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
    server.use(
      http.post(`${apiRoot}/auth/login`, () =>
        HttpResponse.json({ data: { ...tokenResponse().data, user: later } }),
      ),
      http.get(`${apiRoot}/me`, () => HttpResponse.json({ data: later })),
      http.get(`${root}/report-exports`, () => HttpResponse.json(page([]))),
      http.get(`${root}/audit-logs`, () => HttpResponse.json(page([]))),
    );
    await act(async () => {
      await session.login({ email: later.email, password: 'test-only-password' });
      await router.navigate(`/organizations/${a.id}/${area}`);
    });
    await screen.findByText(
      area === 'reports' ? 'No exports available yet.' : 'No audit entries match these filters.',
    );
    expect(screen.queryByText(exportId)).not.toBeInTheDocument();
    expect(screen.queryByText('invoice.issued')).not.toBeInTheDocument();
    expect(
      query
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] === 'organization' && q.queryKey[1] === testUser.id),
    ).toHaveLength(0);
  },
);
it.each(['reports', 'audit-logs'])('handles backend 403 safely in %s', async (area) => {
  server.use(
    http.get(`${root}/${area === 'reports' ? 'report-exports' : 'audit-logs'}`, () =>
      authFailure('FORBIDDEN', 403),
    ),
  );
  mount(area);
  await screen.findByText('You do not have permission to perform this action.');
  expect(screen.queryByText('Private server text')).not.toBeInTheDocument();
});
it('handles missing export metadata without exposing internal error text', async () => {
  server.use(http.get(`${root}/report-exports/:id`, () => authFailure('NOT_FOUND', 404)));
  mount('reports', a.id, `?exportId=${exportId}`);
  await screen.findByText('The requested resource could not be found.');
  expect(screen.queryByRole('button', { name: 'Download selected CSV' })).not.toBeInTheDocument();
});
it.each(['reports', 'audit-logs'])(
  'uses opaque cursors for %s and resets them after filters change',
  async (area) => {
    server.use(
      http.get(`${root}/${area === 'reports' ? 'report-exports' : 'audit-logs'}`, ({ request }) => {
        const url = new URL(request.url);
        reads.push(url);
        return HttpResponse.json(
          page([], 25, url.searchParams.has('after') ? null : 'opaque_next'),
        );
      }),
    );
    mount(area);
    await screen.findByRole('button', { name: 'Next records' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next records' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Next records' }));
    await waitFor(() => expect(reads.at(-1)!.searchParams.get('after')).toBe('opaque_next'));
    await screen.findByText('Page 2');
    if (area === 'reports')
      await userEvent.selectOptions(screen.getByLabelText('Export status filter'), 'FAILED');
    else await userEvent.click(screen.getByRole('button', { name: 'Apply audit filters' }));
    await screen.findByText('Page 1');
    expect(reads.at(-1)!.searchParams.has('after')).toBe(false);
  },
);
