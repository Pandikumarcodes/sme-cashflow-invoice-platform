import { StrictMode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { beforeEach, afterEach, expect, it } from 'vitest';
import './PaymentPages';
import '../invoices/InvoicePages';
import { AuthProvider } from '../../auth/AuthProvider';
import { createSession } from '../../auth/session';
import { createQueryClient } from '../../app/query-client';
import { routes } from '../../routes/routes';
import { server } from '../../test/server';
import {
  apiRoot,
  authHandlers,
  authFailure,
  deferred as makeDeferred,
  testUser,
  tokenResponse,
} from '../../test/auth-fixtures';
import { dashboardOrg as a, secondOrg } from '../dashboard/test-fixtures';
import { invoiceKeys } from '../invoices/queries';
import { organizationKeys } from '../../organizations/query-keys';
import { localToday } from '../dashboard/dates';
import {
  paymentFixture,
  reversedFixture,
  invoiceFixture,
  invoiceId,
  paymentId,
} from './test-fixtures';
import type { Payment } from './contracts';
import { paymentKeys } from './queries';

const b = { ...secondOrg, membership: { ...secondOrg.membership, role: 'OWNER' } };
const root = `${apiRoot}/organizations/:org/payments`;
const invoices = `${apiRoot}/organizations/:org/invoices`;
const path = (suffix = '', org = a.id) => `/organizations/${org}/payments${suffix}`;
let current: Payment;
let currentInvoice: ReturnType<typeof invoiceFixture>;
let reads: URL[];
const disposers: (() => void)[] = [];
const gates: (() => void)[] = [];
const dialogDescriptors = ['showModal', 'close'].map(
  (name) => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)] as const,
);
function deferred() {
  const value = makeDeferred();
  gates.push(value.resolve);
  return value;
}
const page = (request: Request, data: unknown[] = [current], cursor: string | null = null) =>
  HttpResponse.json({
    data,
    meta: {
      limit: Number(new URL(request.url).searchParams.get('limit') ?? 25),
      hasMore: cursor !== null,
      nextCursor: cursor,
    },
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
  disposers.push(() => {
    router.dispose();
    query.clear();
  });
  return { query, router };
}
beforeEach(() => {
  localStorage.clear();
  current = paymentFixture();
  currentInvoice = invoiceFixture();
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
    http.get(root, ({ request, params }) => {
      reads.push(new URL(request.url));
      return page(request, [{ ...current, organizationId: String(params.org) }]);
    }),
    http.get(`${root}/:id`, ({ params }) =>
      HttpResponse.json({ data: { ...current, organizationId: String(params.org) } }),
    ),
    http.get(invoices, ({ request, params }) =>
      page(request, [{ ...currentInvoice, organizationId: String(params.org) }]),
    ),
    http.get(`${invoices}/:id`, ({ params }) =>
      HttpResponse.json(
        { data: { ...currentInvoice, organizationId: String(params.org) } },
        { headers: { ETag: `"${currentInvoice.version}"` } },
      ),
    ),
  );
});
afterEach(() => {
  cleanup();
  gates.splice(0).forEach((release) => release());
  disposers.splice(0).forEach((dispose) => dispose());
  localStorage.clear();
  dialogDescriptors.forEach(([name, descriptor]) => {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });
});
async function fillPayment(amount = '40.00') {
  await screen.findByLabelText('Payment amount (USD)');
  fireEvent.change(screen.getByLabelText('Payment amount (USD)'), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-10-01' } });
  return userEvent.setup();
}
async function openReversal() {
  await screen.findByRole('heading', { name: 'Payment details' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Reverse payment in full' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Reversal reason'), {
    target: { value: 'Duplicate receipt' },
  });
  fireEvent.change(within(dialog).getByLabelText('Reversal date'), {
    target: { value: '2026-10-02' },
  });
  return { user, dialog };
}
it('renders lazy payment history with exact amounts and permission-aware navigation', async () => {
  const { query } = mount();
  await screen.findByRole('heading', { name: 'Payments' });
  await screen.findByRole('table', { name: 'Payment history' });
  expect(screen.getByRole('link', { name: 'Payments' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('$40.00 USD')).toBeInTheDocument();
  expect(screen.getByText('2026-10-01')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'INV-00001' })).toHaveAttribute(
    'href',
    `/organizations/${a.id}/invoices/${invoiceId}`,
  );
  expect(
    query
      .getQueryCache()
      .getAll()
      .some((q) => q.queryKey.slice(0, 4).join() === paymentKeys.scope(testUser.id, a.id).join()),
  ).toBe(true);
  expect(screen.queryByText(/Total collected/)).not.toBeInTheDocument();
});
it('uses server cursors, revisits previous pages and resets on supported filters/sorts', async () => {
  server.use(
    http.get(root, ({ request }) => {
      reads.push(new URL(request.url));
      return page(
        request,
        [current],
        new URL(request.url).searchParams.has('after') ? null : 'next_payment_cursor',
      );
    }),
  );
  mount();
  await screen.findByRole('heading', { name: 'Payments' });
  await screen.findByRole('table');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Next payments' }));
  await screen.findByText('Payment page 2');
  await screen.findByRole('table');
  expect(reads.at(-1)?.searchParams.get('after')).toBe('next_payment_cursor');
  await user.click(screen.getByRole('button', { name: 'Previous payments' }));
  await screen.findByRole('table');
  expect(reads.at(-1)?.searchParams.has('after')).toBe(false);
  await user.click(screen.getByRole('button', { name: 'More filters' }));
  await user.selectOptions(screen.getByLabelText('Sort payments by'), 'amount');
  await screen.findByRole('table');
  expect(reads.at(-1)?.searchParams.get('sortBy')).toBe('amount');
  await user.selectOptions(screen.getByLabelText('Payment method'), 'BANK_TRANSFER');
  await screen.findByRole('table');
  expect(reads.at(-1)?.searchParams.get('method')).toBe('BANK_TRANSFER');
  await user.selectOptions(screen.getByLabelText('Payment page size'), '50');
  await screen.findByRole('table');
  expect(reads.at(-1)?.searchParams.get('limit')).toBe('50');
});
it('supports invoice-related history and validates filters before financial requests', async () => {
  mount(`?invoiceId=${invoiceId}`);
  await screen.findByRole('heading', { name: 'Payments' });
  await screen.findByRole('table');
  expect(reads.at(-1)?.searchParams.get('invoiceId')).toBe(invoiceId);
  const count = reads.length;
  fireEvent.click(screen.getByRole('button', { name: 'More filters (1 active)' }));
  fireEvent.change(screen.getByLabelText('Payment date from'), { target: { value: '2026-10-02' } });
  fireEvent.change(screen.getByLabelText('Payment date to'), { target: { value: '2026-10-01' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('ordered');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  // The from-only filter is valid and may have initiated one canceled read.
  expect(reads.length).toBeLessThanOrEqual(count + 1);
});
it('withholds data while loading and renders an empty payment page', async () => {
  const pending = deferred();
  const started = deferred();
  server.use(
    http.get(root, async ({ request }) => {
      started.resolve();
      await pending.promise;
      return page(request, []);
    }),
  );
  mount();
  await started.promise;
  expect(screen.getByText('Loading payments…')).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  pending.resolve();
  expect(await screen.findByText('No payments match these filters.')).toBeInTheDocument();
});
it.each([403, 404])(
  'handles safe payment read rejection %s without protected values',
  async (status) => {
    server.use(http.get(`${root}/:id`, () => authFailure('NOT_FOUND', status)));
    mount(`/${paymentId}`);
    await screen.findByRole('heading', {
      name: status === 404 ? 'Payment not found' : 'Access denied',
    });
    expect(screen.queryByText('$40.00 USD')).not.toBeInTheDocument();
    expect(screen.queryByText('Private server text')).not.toBeInTheDocument();
  },
);
it('restarts an invalid cursor rather than constructing a replacement', async () => {
  server.use(
    http.get(root, ({ request }) =>
      new URL(request.url).searchParams.has('after')
        ? authFailure('INVALID_CURSOR', 400)
        : page(request, [current], 'bad_cursor'),
    ),
  );
  mount();
  await screen.findByRole('table');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Next payments' }));
  await user.click(await screen.findByRole('button', { name: 'Restart payment pagination' }));
  expect(await screen.findByRole('table')).toBeInTheDocument();
});
it('selects only issued invoices with remaining balance and pages without downloading every invoice', async () => {
  const requested: URL[] = [];
  server.use(
    http.get(invoices, ({ request }) => {
      const url = new URL(request.url);
      requested.push(url);
      const data = url.searchParams.has('after')
        ? [invoiceFixture()]
        : [invoiceFixture({ balanceDue: '0.00', amountPaid: '100.00', paymentState: 'PAID' })];
      return HttpResponse.json({
        data,
        meta: {
          limit: 25,
          nextCursor: url.searchParams.has('after') ? null : 'eligible_next',
          hasMore: !url.searchParams.has('after'),
        },
      });
    }),
  );
  mount('/new');
  await screen.findByLabelText('Invoice to settle');
  expect(screen.queryByRole('option', { name: /INV-00001/ })).not.toBeInTheDocument();
  expect(requested.every((url) => url.searchParams.get('status') === 'ISSUED')).toBe(true);
  expect(requested.some((url) => url.searchParams.has('after'))).toBe(false);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Next eligible invoices' }));
  await screen.findByRole('option', { name: /INV-00001/ });
  await user.selectOptions(screen.getByLabelText('Invoice to settle'), invoiceId);
  await screen.findByLabelText('Payment amount (USD)');
  expect(requested.at(-1)?.searchParams.get('after')).toBe('eligible_next');
});
it.each([
  {
    status: 'DRAFT',
    invoiceNumber: null,
    sequenceValue: null,
    issuedAt: null,
    issuedByUserId: null,
    paymentState: 'NOT_APPLICABLE',
  },
  { amountPaid: '100.00', balanceDue: '0.00', paymentState: 'PAID' },
])('rejects a direct ineligible invoice selection %#', async (overrides) => {
  currentInvoice = invoiceFixture(overrides);
  mount(`/new?invoiceId=${invoiceId}`);
  expect(await screen.findByRole('alert')).toHaveTextContent('not eligible');
  expect(screen.queryByLabelText('Payment amount (USD)')).not.toBeInTheDocument();
});
it('validates positive amount, minor units and authoritative remaining balance without sending', async () => {
  let calls = 0;
  server.use(
    http.post(`${invoices}/:id/payments`, () => {
      calls++;
      return HttpResponse.json({ data: current }, { status: 201 });
    }),
  );
  mount(`/new?invoiceId=${invoiceId}`);
  const user = await fillPayment('0');
  await user.click(screen.getByRole('button', { name: 'Record payment' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('positive');
  fireEvent.change(screen.getByLabelText('Payment amount (USD)'), { target: { value: '0.001' } });
  await user.click(screen.getByRole('button', { name: 'Record payment' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('decimal places');
  fireEvent.change(screen.getByLabelText('Payment amount (USD)'), { target: { value: '100.01' } });
  await user.click(screen.getByRole('button', { name: 'Record payment' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('exceeds');
  expect(calls).toBe(0);
});
it('defaults business date to the organization timezone without time conversion', async () => {
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}`, () =>
      HttpResponse.json({ data: { ...a, timezone: 'Pacific/Kiritimati' } }),
    ),
  );
  mount(`/new?invoiceId=${invoiceId}`);
  await screen.findByLabelText('Payment date');
  expect(screen.getByLabelText('Payment date')).toHaveValue(localToday('Pacific/Kiritimati'));
});
it('records once with a generated key, exact DTO and confirmed server receipt; invalidates settlement caches', async () => {
  const pending = deferred();
  const started = deferred();
  let calls = 0;
  server.use(
    http.post(`${invoices}/:id/payments`, async ({ request }) => {
      calls++;
      expect(request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
      expect(request.headers.has('If-Match')).toBe(false);
      expect(await request.json()).toEqual({
        amount: '40.00',
        paymentDate: '2026-10-01',
        method: 'BANK_TRANSFER',
      });
      started.resolve();
      await pending.promise;
      currentInvoice = invoiceFixture({
        amountPaid: '40.00',
        balanceDue: '60.00',
        paymentState: 'PARTIALLY_PAID',
        version: 4,
      });
      return HttpResponse.json({ data: current }, { status: 201 });
    }),
  );
  const { query } = mount(`/new?invoiceId=${invoiceId}`);
  const user = await fillPayment();
  const listKey = [...invoiceKeys.scope(testUser.id, a.id), 'sentinel'];
  const dashboardKey = [...organizationKeys.scope(testUser.id, a.id), 'dashboard', 'sentinel'];
  const paymentsKey = [...paymentKeys.scope(testUser.id, a.id), 'sentinel'];
  const financialKeys = ['cash-flow', 'profit-loss', 'receivables-aging'].map((kind) => [
    ...organizationKeys.scope(testUser.id, a.id),
    kind,
    'sentinel',
  ]);
  for (const key of [listKey, dashboardKey, paymentsKey, ...financialKeys])
    query.setQueryData(key, 'old');
  await user.dblClick(screen.getByRole('button', { name: 'Record payment' }));
  await started.promise;
  expect(screen.getByRole('button', { name: 'Recording payment…' })).toBeDisabled();
  pending.resolve();
  await screen.findByRole('heading', { name: 'Payment recording confirmed' });
  expect(screen.getByText('$40.00 USD · 2026-10-01')).toBeInTheDocument();
  expect(calls).toBe(1);
  for (const key of [listKey, dashboardKey, paymentsKey, ...financialKeys])
    expect(query.getQueryState(key)?.isInvalidated).toBe(true);
});
it('freezes uncertain recording and explicitly retries the identical key/payload without creating a second attempt', async () => {
  const attempts: { key: string | null; body: unknown }[] = [];
  server.use(
    http.post(`${invoices}/:id/payments`, async ({ request }) => {
      attempts.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() });
      return attempts.length === 1
        ? HttpResponse.error()
        : HttpResponse.json(
            { data: current },
            { status: 201, headers: { 'Idempotency-Replayed': 'true' } },
          );
    }),
  );
  mount(`/new?invoiceId=${invoiceId}`);
  const user = await fillPayment();
  await user.click(screen.getByRole('button', { name: 'Record payment' }));
  await screen.findByText(/Outcome uncertain/);
  expect(attempts).toHaveLength(1);
  expect(screen.getByLabelText('Payment amount (USD)')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Payment amount (USD)'), { target: { value: '50.00' } });
  await user.click(screen.getByRole('button', { name: 'Retry same payment attempt' }));
  await screen.findByText(/original recording receipt was recovered/);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
});
it.each(['IDEMPOTENCY_CONFLICT', 'INVOICE_SETTLEMENT_INCONSISTENT', 'PAYMENT_EXCEEDS_BALANCE'])(
  'blocks a fresh recording after %s until explicit settlement reload',
  async (code) => {
    let calls = 0;
    server.use(
      http.post(`${invoices}/:id/payments`, () => {
        calls++;
        return authFailure(code, code === 'PAYMENT_EXCEEDS_BALANCE' ? 422 : 409);
      }),
    );
    mount(`/new?invoiceId=${invoiceId}`);
    const user = await fillPayment();
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await screen.findByRole('button', { name: 'Reload invoice before a new attempt' });
    expect(
      screen.queryByRole('button', { name: 'Retry same payment attempt' }),
    ).not.toBeInTheDocument();
    expect(calls).toBe(1);
  },
);
it('shows server payment detail and integrates invoice record/history links', async () => {
  const { router } = mount(`/${paymentId}`);
  await screen.findByRole('heading', { name: 'Payment details' });
  expect(screen.getByText('$60.00 USD')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'View invoice INV-00001' }));
  await screen.findByRole('heading', { name: 'INV-00001' });
  expect(screen.getByRole('link', { name: 'Record payment' })).toHaveAttribute(
    'href',
    path(`/new?invoiceId=${invoiceId}`),
  );
  await userEvent.click(screen.getByRole('link', { name: 'View invoice payments' }));
  await screen.findByRole('table', { name: 'Payment history' });
  expect(router.state.location.search).toBe(`?invoiceId=${invoiceId}`);
});
it('requires reversal confirmation and evidence, traps focus and supports Escape before submission', async () => {
  mount(`/${paymentId}`);
  await screen.findByRole('button', { name: 'Reverse payment in full' });
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name: 'Reverse payment in full' });
  await user.click(trigger);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/complete \$40.00 USD/)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Keep payment unchanged' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(within(dialog).getByRole('button', { name: 'Confirm full reversal' })).toHaveFocus();
  await user.click(within(dialog).getByRole('button', { name: 'Confirm full reversal' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('visible reason');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
it('reverses the full payment exactly once with a key, reason/date and no amount or If-Match', async () => {
  const pending = deferred();
  const started = deferred();
  let calls = 0;
  server.use(
    http.post(`${root}/:id/reverse`, async ({ request }) => {
      calls++;
      expect(request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
      expect(request.headers.has('If-Match')).toBe(false);
      expect(await request.json()).toEqual({
        reason: 'Duplicate receipt',
        reversalDate: '2026-10-02',
      });
      started.resolve();
      await pending.promise;
      current = reversedFixture();
      return HttpResponse.json({ data: current });
    }),
  );
  const { query } = mount(`/${paymentId}`);
  const analyticsKeys = ['dashboard', 'cash-flow', 'profit-loss', 'receivables-aging'].map(
    (kind) => [...organizationKeys.scope(testUser.id, a.id), kind, 'sentinel'],
  );
  const other = [...organizationKeys.scope(testUser.id, b.id), 'cash-flow', 'sentinel'];
  const { user, dialog } = await openReversal();
  for (const key of [...analyticsKeys, other]) query.setQueryData(key, 'old');
  await user.dblClick(within(dialog).getByRole('button', { name: 'Confirm full reversal' }));
  await started.promise;
  expect(within(dialog).getByRole('button', { name: 'Reversing payment…' })).toBeDisabled();
  pending.resolve();
  await screen.findByRole('region', { name: 'Full reversal details' });
  expect(screen.getByText('Duplicate receipt')).toBeInTheDocument();
  expect(calls).toBe(1);
  expect(screen.queryByRole('button', { name: 'Reverse payment in full' })).not.toBeInTheDocument();
  for (const key of analyticsKeys) expect(query.getQueryState(key)?.isInvalidated).toBe(true);
  expect(query.getQueryState(other)?.isInvalidated).toBe(false);
});
it('retains the same reversal key and reason on explicit retry after an uncertain outcome', async () => {
  const attempts: { key: string | null; body: unknown }[] = [];
  server.use(
    http.post(`${root}/:id/reverse`, async ({ request }) => {
      attempts.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() });
      if (attempts.length === 1) return HttpResponse.error();
      current = reversedFixture();
      return HttpResponse.json({ data: current }, { headers: { 'Idempotency-Replayed': 'true' } });
    }),
  );
  mount(`/${paymentId}`);
  const { user, dialog } = await openReversal();
  await user.click(within(dialog).getByRole('button', { name: 'Confirm full reversal' }));
  await within(dialog).findByText(/outcome uncertain/);
  expect(within(dialog).getByLabelText('Reversal reason')).toBeDisabled();
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Retry same reversal attempt' }));
  await screen.findByRole('region', { name: 'Full reversal details' });
  expect(attempts[1]).toEqual(attempts[0]);
});
it.each(['PAYMENT_ALREADY_REVERSED', 'INVALID_INVOICE_STATE', 'IDEMPOTENCY_CONFLICT'])(
  'handles reversal conflict %s without automatic retry',
  async (code) => {
    let calls = 0;
    server.use(
      http.post(`${root}/:id/reverse`, () => {
        calls++;
        return authFailure(code, 409);
      }),
    );
    mount(`/${paymentId}`);
    const { user, dialog } = await openReversal();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm full reversal' }));
    await within(dialog).findByRole('button', { name: 'Reload payment before another action' });
    expect(calls).toBe(1);
  },
);
it('hides reversals for already reversed payments and terminal invoice states', async () => {
  current = reversedFixture();
  mount(`/${paymentId}`);
  await screen.findByRole('region', { name: 'Full reversal details' });
  expect(screen.queryByRole('button', { name: 'Reverse payment in full' })).not.toBeInTheDocument();
});
it('denies payment routes and hides navigation for roles without payment permission', async () => {
  let calls = 0;
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}`, () =>
      HttpResponse.json({ data: { ...a, membership: { ...a.membership, role: 'VIEWER' } } }),
    ),
    http.get(root, () => {
      calls++;
      return HttpResponse.json({});
    }),
  );
  mount('/new');
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  expect(screen.queryByRole('link', { name: 'Payments' })).not.toBeInTheDocument();
  expect(calls).toBe(0);
});
it('cancels stale tenant reads, removes old caches and switches to the new payment list', async () => {
  const pending = deferred();
  const started = deferred();
  let signal: AbortSignal | undefined;
  server.use(
    http.get(root, async ({ request, params }) => {
      if (params.org === a.id) {
        signal = request.signal;
        started.resolve();
        await pending.promise;
      }
      return page(request, [
        paymentFixture({
          organizationId: String(params.org),
          amount: params.org === a.id ? '40.00' : '20.00',
        }),
      ]);
    }),
  );
  const { query, router } = mount();
  await started.promise;
  await userEvent.selectOptions(screen.getByLabelText('Organization'), b.id);
  await screen.findByRole('table');
  expect(router.state.location.pathname).toBe(path('', b.id));
  expect(signal?.aborted).toBe(true);
  pending.resolve();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(screen.queryByText('$40.00 USD')).not.toBeInTheDocument();
  expect(screen.getByText('$20.00 USD')).toBeInTheDocument();
  expect(query.getQueriesData({ queryKey: paymentKeys.scope(testUser.id, a.id) })).toEqual([]);
});
it('ignores a late recording response after tenant switch without showing a receipt or redirecting', async () => {
  const pending = deferred();
  const started = deferred();
  server.use(
    http.post(`${invoices}/:id/payments`, async () => {
      started.resolve();
      await pending.promise;
      return HttpResponse.json({ data: current }, { status: 201 });
    }),
  );
  const { router, query } = mount(`/new?invoiceId=${invoiceId}`);
  const user = await fillPayment();
  await user.click(screen.getByRole('button', { name: 'Record payment' }));
  await started.promise;
  await user.selectOptions(screen.getByLabelText('Organization'), b.id);
  await screen.findByRole('table');
  pending.resolve();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(router.state.location.pathname).toBe(path('', b.id));
  expect(
    screen.queryByRole('heading', { name: 'Payment recording confirmed' }),
  ).not.toBeInTheDocument();
  expect(query.getQueriesData({ queryKey: paymentKeys.scope(testUser.id, a.id) })).toEqual([]);
});
it('does not automatically replay a payment 401 and clears the authenticated view', async () => {
  let calls = 0;
  server.use(
    http.post(`${invoices}/:id/payments`, () => {
      calls++;
      return authFailure();
    }),
  );
  mount(`/new?invoiceId=${invoiceId}`);
  const user = await fillPayment();
  await user.click(screen.getByRole('button', { name: 'Record payment' }));
  await screen.findByRole('heading', { name: 'Sign in' });
  expect(calls).toBe(1);
});
it('preserves an uncertain attempt through membership revalidation and explicitly recovers the same receipt', async () => {
  const attempts: string[] = [];
  server.use(
    http.post(`${invoices}/:id/payments`, async ({ request }) => {
      attempts.push(request.headers.get('Idempotency-Key')!);
      return attempts.length === 1
        ? HttpResponse.error()
        : HttpResponse.json(
            { data: current },
            { status: 201, headers: { 'Idempotency-Replayed': 'true' } },
          );
    }),
  );
  const { query } = mount(`/new?invoiceId=${invoiceId}`);
  const user = await fillPayment();
  await user.click(screen.getByRole('button', { name: 'Record payment' }));
  await screen.findByText(/Outcome uncertain/);
  const pending = deferred();
  const started = deferred();
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}`, async () => {
      started.resolve();
      await pending.promise;
      return HttpResponse.json({ data: a });
    }),
  );
  let refresh!: Promise<void>;
  act(() => {
    refresh = query.refetchQueries({ queryKey: organizationKeys.context(testUser.id, a.id) });
  });
  await started.promise;
  await waitFor(() =>
    expect(screen.queryByLabelText('Payment amount (USD)')).not.toBeInTheDocument(),
  );
  await act(async () => {
    pending.resolve();
    await refresh;
  });
  await screen.findByRole('button', { name: 'Retry same payment attempt' });
  expect(screen.getByLabelText('Payment amount (USD)')).toHaveValue('40.00');
  expect(screen.getByLabelText('Payment amount (USD)')).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Retry same payment attempt' }));
  await screen.findByRole('heading', { name: 'Payment recording confirmed' });
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toBe(attempts[0]);
});
it('keeps an earlier uncertain outcome locked when a later same-key retry is rejected', async () => {
  let calls = 0;
  server.use(
    http.post(`${invoices}/:id/payments`, () =>
      ++calls === 1 ? HttpResponse.error() : authFailure('FORBIDDEN', 403),
    ),
  );
  mount(`/new?invoiceId=${invoiceId}`);
  const user = await fillPayment();
  await user.click(screen.getByRole('button', { name: 'Record payment' }));
  await user.click(await screen.findByRole('button', { name: 'Retry same payment attempt' }));
  await screen.findByText('You do not have permission to perform this action.');
  expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Reload invoice before a new attempt' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry same payment attempt' })).toBeInTheDocument();
  expect(calls).toBe(2);
});
it('generates a new key only after a definitive rejection, authoritative reload and a changed logical submission', async () => {
  const attempts: { key: string | null; amount: string }[] = [];
  server.use(
    http.post(`${invoices}/:id/payments`, async ({ request }) => {
      const body = (await request.json()) as { amount: string };
      attempts.push({ key: request.headers.get('Idempotency-Key'), amount: body.amount });
      return attempts.length === 1
        ? authFailure('PAYMENT_EXCEEDS_BALANCE', 422)
        : HttpResponse.json({ data: paymentFixture({ amount: '30.00' }) }, { status: 201 });
    }),
  );
  mount(`/new?invoiceId=${invoiceId}`);
  const user = await fillPayment();
  await user.click(screen.getByRole('button', { name: 'Record payment' }));
  await user.click(
    await screen.findByRole('button', { name: 'Reload invoice before a new attempt' }),
  );
  await fillPayment('30.00');
  await user.click(screen.getByRole('button', { name: 'Record payment' }));
  await screen.findByRole('heading', { name: 'Payment recording confirmed' });
  expect(attempts).toHaveLength(2);
  expect(attempts[1]!.key).not.toBe(attempts[0]!.key);
  expect(attempts[1]!.amount).toBe('30.00');
});
it('treats server failure as uncertain without automatically replaying', async () => {
  let calls = 0;
  server.use(
    http.post(`${invoices}/:id/payments`, () => {
      calls++;
      return authFailure('INTERNAL_ERROR', 500);
    }),
  );
  mount(`/new?invoiceId=${invoiceId}`);
  const user = await fillPayment();
  await user.click(screen.getByRole('button', { name: 'Record payment' }));
  await screen.findByText(/Outcome uncertain/);
  expect(calls).toBe(1);
  expect(screen.getByRole('button', { name: 'Retry same payment attempt' })).toBeInTheDocument();
});
it('hides fresh reversal on a terminal invoice even if a recorded payment is returned', async () => {
  current = paymentFixture({
    invoice: { ...current.invoice, status: 'VOID', paymentState: 'NOT_APPLICABLE' },
  });
  mount(`/${paymentId}`);
  await screen.findByRole('heading', { name: 'Payment details' });
  expect(screen.queryByRole('button', { name: 'Reverse payment in full' })).not.toBeInTheDocument();
});
it('withholds payment values after membership permission revocation', async () => {
  const { query } = mount();
  await screen.findByRole('table');
  server.use(
    http.get(`${apiRoot}/organizations/${a.id}`, () =>
      HttpResponse.json({ data: { ...a, membership: { ...a.membership, role: 'VIEWER' } } }),
    ),
  );
  await act(async () => {
    await query.refetchQueries({ queryKey: organizationKeys.context(testUser.id, a.id) });
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  expect(screen.queryByText('$40.00 USD')).not.toBeInTheDocument();
});
it('uses bounded read retry and recovers payment history through an explicit retry', async () => {
  let fail = true;
  let calls = 0;
  const requests: Request[] = [];
  server.use(
    http.get(root, ({ request }) => {
      calls++;
      requests.push(request);
      return fail ? HttpResponse.error() : page(request);
    }),
  );
  const { query } = mount();
  query.setDefaultOptions({ queries: { ...query.getDefaultOptions().queries, retryDelay: 0 } });
  await screen.findByRole('button', { name: 'Retry payment request' });
  // StrictMode can start and abort a preliminary read; completed failures still retry once.
  expect(requests.filter((request) => !request.signal.aborted)).toHaveLength(2);
  const previousCalls = calls;
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Retry payment request' }));
  await screen.findByRole('table');
  await waitFor(() => expect(calls).toBe(previousCalls + 1));
});
it('changes the selected invoice and discards unsent input when the scoped recording destination changes', async () => {
  const nextId = 'dddddddd-dddd-4ddd-8ddd-ddddddddddde';
  server.use(
    http.get(`${invoices}/:id`, ({ params }) =>
      HttpResponse.json(
        {
          data: invoiceFixture({
            id: String(params.id),
            invoiceNumber: params.id === nextId ? 'INV-NEXT' : 'INV-00001',
          }),
        },
        { headers: { ETag: '"3"' } },
      ),
    ),
  );
  const { router } = mount(`/new?invoiceId=${invoiceId}`);
  await fillPayment();
  await act(async () => {
    await router.navigate(path(`/new?invoiceId=${nextId}`));
  });
  await screen.findByRole('heading', { name: 'Record payment for INV-NEXT' });
  expect(screen.getByLabelText('Payment amount (USD)')).toHaveValue('');
});
