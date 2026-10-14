import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
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
import { dashboardOrg as org, secondOrg } from '../features/dashboard/test-fixtures';
import { organizationKeys } from './query-keys';
import { createOrganizationSchema, organizationCreationBody } from './create-contract';

const disposers: (() => void)[] = [];
const gates: (() => void)[] = [];
beforeAll(async () => {
  await import('./CreateOrganizationPage');
});
beforeEach(() => {
  localStorage.clear();
  server.use(
    http.post(`${apiRoot}/auth/refresh`, () => HttpResponse.json(tokenResponse())),
    ...authHandlers(),
    http.get(`${apiRoot}/organizations`, () => HttpResponse.json({ data: [] })),
    http.get(`${apiRoot}/organizations/${org.id}`, () => HttpResponse.json({ data: org })),
  );
});
afterEach(() => {
  gates.splice(0).forEach((done) => done());
  disposers.splice(0).forEach((dispose) => dispose());
  localStorage.clear();
});
function mount(path = '/workspace') {
  const query = createQueryClient();
  const session = createSession(query, apiRoot);
  function configure(route: RouteObject): RouteObject {
    if (route.path?.endsWith('/dashboard'))
      return { path: route.path, element: <h1>Dashboard</h1> };
    if (route.index) return route;
    return { ...route, children: route.children?.map(configure) };
  }
  const configured = routes.map(configure);
  const router = createMemoryRouter(configured, { initialEntries: [path] });
  render(
    <QueryClientProvider client={query}>
      <AuthProvider session={session}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  disposers.push(() => {
    router.dispose();
    query.clear();
  });
  return { router, session, query };
}
async function openForm() {
  await screen.findByRole('heading', { name: 'No organizations yet' });
  expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'Create Organization' }));
  await screen.findByLabelText('Legal business name');
}
async function fill() {
  await userEvent.type(screen.getByLabelText('Legal business name'), 'New Business');
  await userEvent.type(screen.getByLabelText('Base currency'), 'USD');
  await userEvent.clear(screen.getByLabelText('Timezone'));
  await userEvent.type(screen.getByLabelText('Timezone'), 'UTC');
}
it('offers onboarding for an empty account and validates without sending a command', async () => {
  let commands = 0;
  server.use(
    http.post(`${apiRoot}/organizations`, () => {
      commands++;
      return HttpResponse.json({ data: org });
    }),
  );
  mount();
  await openForm();
  await userEvent.click(screen.getByRole('button', { name: 'Create Organization' }));
  expect(await screen.findByText('Enter the legal business name.')).toBeInTheDocument();
  expect(screen.getByText('Enter a supported three-letter currency code.')).toBeInTheDocument();
  expect(commands).toBe(0);
});
it('validates DTO bounds and registries and submits only allowed normalized fields', () => {
  const valid = {
    legalName: ' Business ',
    displayName: '',
    baseCurrency: ' usd ',
    timezone: ' UTC ',
  };
  expect(organizationCreationBody(createOrganizationSchema.parse(valid))).toEqual({
    legalName: 'Business',
    baseCurrency: 'USD',
    timezone: 'UTC',
  });
  for (const invalid of [
    { legalName: ' ' },
    { legalName: 'x'.repeat(201) },
    { displayName: ' ' },
    { displayName: 'x'.repeat(201) },
    { baseCurrency: 'ZZZ' },
    { timezone: 'Invalid/Timezone' },
    { timezone: 'x'.repeat(65) },
  ])
    expect(createOrganizationSchema.safeParse({ ...valid, ...invalid }).success).toBe(false);
});
it('reloads active membership, selects the created organization, opens Dashboard and restores permission navigation', async () => {
  let created = false;
  let body: unknown;
  server.use(
    http.get(`${apiRoot}/organizations`, () => HttpResponse.json({ data: created ? [org] : [] })),
    http.post(`${apiRoot}/organizations`, async ({ request }) => {
      body = await request.json();
      created = true;
      return HttpResponse.json({ data: org }, { status: 201 });
    }),
  );
  const { router, query } = mount();
  await openForm();
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Create Organization' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
  expect(body).toEqual({ legalName: 'New Business', baseCurrency: 'USD', timezone: 'UTC' });
  expect(router.state.location.pathname).toBe(`/organizations/${org.id}/dashboard`);
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Organization' })).toHaveValue(org.id),
  );
  for (const name of [
    'Dashboard',
    'Customers',
    'Invoices',
    'Payments',
    'Expenses',
    'Cash Flow',
    'Profit & Loss',
    'Receivables Aging',
    'Notifications',
    'Reports',
    'Audit Logs',
  ])
    expect(screen.getByRole('link', { name })).toBeInTheDocument();
  expect(query.getQueryData(organizationKeys.list(testUser.id))).toEqual([org]);
});
it('does not grant access from the creation response and retries verification without creating twice', async () => {
  let commands = 0;
  let visible = false;
  server.use(
    http.post(`${apiRoot}/organizations`, () => {
      commands++;
      return HttpResponse.json({ data: org }, { status: 201 });
    }),
    http.get(`${apiRoot}/organizations`, () => HttpResponse.json({ data: visible ? [org] : [] })),
  );
  const { router } = mount();
  await openForm();
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Create Organization' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('access could not be verified');
  expect(router.state.location.pathname).toBe('/organizations/new');
  expect(screen.queryByRole('link', { name: 'Payments' })).not.toBeInTheDocument();
  visible = true;
  await userEvent.click(screen.getByRole('button', { name: 'Retry access check' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
  expect(commands).toBe(1);
});
it.each([403, 409, 422, 429])(
  'handles creation error %s without selecting an organization',
  async (status) => {
    server.use(
      http.post(`${apiRoot}/organizations`, () =>
        authFailure(status === 403 ? 'FORBIDDEN' : 'INVALID_REQUEST', status),
      ),
    );
    const { router } = mount();
    await openForm();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create Organization' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('Private server text');
    expect(router.state.location.pathname).toBe('/organizations/new');
    expect(screen.getByRole('button', { name: 'Create Organization' })).toBeEnabled();
  },
);
it.each(['network', 'server', 'malformed'])(
  'blocks duplicate creation after an uncertain %s outcome',
  async (outcome) => {
    let commands = 0;
    server.use(
      http.post(`${apiRoot}/organizations`, () => {
        commands++;
        if (outcome === 'network') return HttpResponse.error();
        if (outcome === 'server') return authFailure('INVALID_REQUEST', 500);
        return HttpResponse.json({ data: { id: org.id } }, { status: 201 });
      }),
    );
    const { router } = mount();
    await openForm();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create Organization' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Creation could not be confirmed');
    expect(screen.getByRole('button', { name: 'Create Organization' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Create Organization' }));
    expect(commands).toBe(1);
    expect(router.state.location.pathname).toBe('/organizations/new');
    expect(screen.getByRole('link', { name: 'Back to workspace' })).toHaveAttribute(
      'href',
      '/workspace',
    );
  },
);
it('requires authentication for the creation route', async () => {
  server.use(http.post(`${apiRoot}/auth/refresh`, () => authFailure()));
  const { router } = mount('/organizations/new/');
  await screen.findByRole('heading', { name: 'Sign in' });
  expect(router.state.location.pathname).toBe('/login');
  expect(screen.queryByRole('button', { name: 'Create Organization' })).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Email address'), testUser.email);
  await userEvent.type(screen.getByLabelText('Password'), 'private-password');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByLabelText('Legal business name');
  expect(router.state.location.pathname).toBe('/organizations/new/');
});
it('maps server validation only to allowed form fields using sanitized messages', async () => {
  server.use(
    http.post(`${apiRoot}/organizations`, () =>
      HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'private SQL',
            fields: [
              { field: 'legalName', code: 'invalid', message: 'private SQL' },
              { field: 'role', code: 'invalid', message: 'private SQL' },
            ],
          },
        },
        { status: 400 },
      ),
    ),
  );
  mount();
  await openForm();
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Create Organization' }));
  await screen.findByText('Check this field.');
  expect(screen.getByLabelText('Legal business name')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByText('private SQL')).not.toBeInTheDocument();
});
it('rejects an inactive membership from the refreshed list even after a successful creation response', async () => {
  let created = false;
  server.use(
    http.post(`${apiRoot}/organizations`, () => {
      created = true;
      return HttpResponse.json({ data: org }, { status: 201 });
    }),
    http.get(`${apiRoot}/organizations`, () =>
      HttpResponse.json({
        data: created ? [{ ...org, membership: { ...org.membership, status: 'SUSPENDED' } }] : [],
      }),
    ),
  );
  const { router } = mount();
  await openForm();
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Create Organization' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('access could not be verified');
  expect(router.state.location.pathname).toBe('/organizations/new');
  expect(screen.queryByRole('link', { name: 'Payments' })).not.toBeInTheDocument();
});
it('keeps onboarding open when another membership exists and selects only the newly verified organization', async () => {
  let visible = false;
  server.use(
    http.post(`${apiRoot}/organizations`, () => HttpResponse.json({ data: org }, { status: 201 })),
    http.get(`${apiRoot}/organizations`, () =>
      HttpResponse.json({ data: visible ? [secondOrg, org] : [secondOrg] }),
    ),
  );
  const { router } = mount('/organizations/new/');
  await screen.findByLabelText('Legal business name');
  await fill();
  expect(router.state.location.pathname).toBe('/organizations/new/');
  await userEvent.click(screen.getByRole('button', { name: 'Create Organization' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Retry access check' })).toBeEnabled();
  visible = true;
  await userEvent.click(screen.getByRole('button', { name: 'Retry access check' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Organization' })).toHaveValue(org.id),
  );
});
it('does not replay unauthorized creation and clears authenticated access', async () => {
  let commands = 0;
  server.use(
    http.post(`${apiRoot}/organizations`, () => {
      commands++;
      return authFailure();
    }),
  );
  mount();
  await openForm();
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Create Organization' }));
  await screen.findByRole('heading', { name: 'Sign in' });
  expect(commands).toBe(1);
});
it('discards a late creation response after switching accounts and clears tenant caches', async () => {
  const gate = deferred();
  gates.push(gate.resolve);
  let started = false;
  server.use(
    http.post(`${apiRoot}/organizations`, async () => {
      started = true;
      await gate.promise;
      return HttpResponse.json({ data: org }, { status: 201 });
    }),
  );
  const { session, query, router } = mount();
  await openForm();
  await fill();
  query.setQueryData([...organizationKeys.scope(testUser.id, org.id), 'private'], {
    secret: 'old tenant',
  });
  await userEvent.click(screen.getByRole('button', { name: 'Create Organization' }));
  await waitFor(() => expect(started).toBe(true));
  const other = {
    ...testUser,
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    email: 'other@example.test',
  };
  server.use(
    http.post(`${apiRoot}/auth/login`, () =>
      HttpResponse.json({ data: { ...tokenResponse().data, user: other } }),
    ),
    http.get(`${apiRoot}/me`, () => HttpResponse.json({ data: other })),
  );
  await act(async () => {
    await session.logout();
    await session.login({ email: other.email, password: 'private-password' });
  });
  gate.resolve();
  await waitFor(() =>
    expect(
      query.getQueryData([...organizationKeys.scope(testUser.id, org.id), 'private']),
    ).toBeUndefined(),
  );
  expect(router.state.location.pathname).not.toBe(`/organizations/${org.id}/dashboard`);
  expect(query.getQueryData(organizationKeys.list(testUser.id))).toBeUndefined();
});
