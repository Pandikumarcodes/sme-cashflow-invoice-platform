import { StrictMode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, it } from 'vitest';
import './AuthPages';
import { AuthProvider } from '../../auth/AuthProvider';
import { createSession } from '../../auth/session';
import { createQueryClient } from '../../app/query-client';
import { routes } from '../../routes/routes';
import { server } from '../../test/server';
import {
  apiRoot,
  authFailure,
  authHandlers,
  deferred as makeDeferred,
  testUser,
  tokenResponse,
} from '../../test/auth-fixtures';

const disposers: (() => void)[] = [];
const gates: (() => void)[] = [];
function deferred() {
  const gate = makeDeferred();
  gates.push(gate.resolve);
  return gate;
}
function mount(path = '/login', state?: unknown) {
  const query = createQueryClient();
  const session = createSession(query, apiRoot);
  const router = createMemoryRouter(routes, { initialEntries: [{ pathname: path, state }] });
  render(
    <StrictMode>
      <QueryClientProvider client={query}>
        <AuthProvider session={session}>
          <RouterProvider router={router} onError={() => undefined} />
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
beforeEach(() => server.use(...authHandlers()));
afterEach(() => {
  cleanup();
  gates.splice(0).forEach((release) => release());
  disposers.splice(0).forEach((dispose) => dispose());
});
async function enterLogin() {
  await screen.findByLabelText('Email address');
  await userEvent.type(screen.getByLabelText('Email address'), testUser.email);
  await userEvent.type(screen.getByLabelText('Password'), 'a-private-password');
}

it('signs in and returns to a valid intended destination', async () => {
  const { router } = mount('/login', { returnTo: '/session?view=account#ready' });
  await enterLogin();
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(
    await screen.findByRole('heading', { name: 'Welcome to SME Finance' }),
  ).toBeInTheDocument();
  expect(router.state.location.search).toBe('?view=account');
  expect(router.state.location.hash).toBe('#ready');
});
it('shows generic credential errors and retains recoverable input', async () => {
  server.use(http.post(`${apiRoot}/auth/login`, () => authFailure('INVALID_CREDENTIALS')));
  mount();
  await enterLogin();
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('email or password is incorrect');
  expect(screen.getByLabelText('Email address')).toHaveValue(testUser.email);
  expect(screen.getByLabelText('Password')).toHaveValue('a-private-password');
  expect(screen.queryByText('Private server text')).not.toBeInTheDocument();
});
it('validates login fields without issuing a login request', async () => {
  let calls = 0;
  server.use(
    http.post(`${apiRoot}/auth/login`, () => {
      calls++;
      return authFailure();
    }),
  );
  mount();
  await screen.findByLabelText('Email address');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
  expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Enter your password.')).toBeInTheDocument();
  expect(calls).toBe(0);
});
it('maps canonical field errors to accessible controls', async () => {
  server.use(
    http.post(`${apiRoot}/auth/login`, () =>
      HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'private',
            fields: [{ field: 'email', code: 'INVALID_FIELD', message: 'private email' }],
          },
        },
        { status: 400 },
      ),
    ),
  );
  mount();
  await enterLogin();
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('Check this field.')).toBeInTheDocument();
  expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-describedby', 'email-error');
});
it('prevents duplicate submissions and supports password visibility', async () => {
  const gate = deferred();
  const started = deferred();
  let calls = 0;
  server.use(
    http.post(`${apiRoot}/auth/login`, async () => {
      calls++;
      started.resolve();
      await gate.promise;
      return HttpResponse.json({ data: { ...tokenResponse().data, user: testUser } });
    }),
  );
  mount();
  await enterLogin();
  await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await started.promise;
  expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
  gate.resolve();
  await screen.findByRole('heading', { name: 'Welcome to SME Finance' });
  expect(calls).toBe(1);
});
it('registers without automatic login and clears the successful form', async () => {
  let logins = 0;
  server.use(
    http.post(`${apiRoot}/auth/login`, () => {
      logins++;
      return authFailure();
    }),
  );
  mount('/register');
  await screen.findByLabelText('First name');
  await userEvent.type(screen.getByLabelText('First name'), 'Alex');
  await userEvent.type(screen.getByLabelText('Last name'), 'Morgan');
  await userEvent.type(screen.getByLabelText('Email address'), testUser.email);
  await userEvent.type(screen.getByLabelText('Password'), 'a-private-password');
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(
    await screen.findByText('Your account is ready. Sign in to continue.'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toHaveValue('');
  expect(logins).toBe(0);
});
it('validates registration names and password against backend limits', async () => {
  mount('/register');
  await screen.findByLabelText('First name');
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByText('Enter your first name.')).toBeInTheDocument();
  expect(screen.getByText('Enter your last name.')).toBeInTheDocument();
  expect(
    screen.getByText('Use 12–128 characters and at most 512 UTF-8 bytes.'),
  ).toBeInTheDocument();
});
it('keeps protected content hidden during checking, then redirects missing sessions', async () => {
  const gate = deferred();
  let refreshes = 0;
  server.use(
    http.post(`${apiRoot}/auth/refresh`, async () => {
      refreshes++;
      await gate.promise;
      return authFailure('INVALID_SESSION');
    }),
  );
  const { router } = mount('/session');
  expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
  expect(screen.queryByText('Welcome to SME Finance')).not.toBeInTheDocument();
  gate.resolve();
  await screen.findByLabelText('Email address');
  expect(router.state.location.pathname).toBe('/login');
  expect(router.state.location.state).toEqual({ returnTo: '/session' });
  expect(refreshes).toBe(1);
});
it('restores a protected page after reload and redirects authenticated login visits', async () => {
  server.use(http.post(`${apiRoot}/auth/refresh`, () => HttpResponse.json(tokenResponse())));
  const { router } = mount('/login');
  expect(
    await screen.findByRole('heading', { name: 'Welcome to SME Finance' }),
  ).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/session');
});
it('rejects external return-to navigation after login', async () => {
  const { router } = mount('/login', { returnTo: 'https://external.test/steal' });
  await enterLogin();
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Welcome to SME Finance' });
  expect(router.state.location.pathname).toBe('/session');
});
it('signs out to a public route and removes account data', async () => {
  server.use(http.post(`${apiRoot}/auth/refresh`, () => HttpResponse.json(tokenResponse())));
  const { query, router } = mount('/session');
  await screen.findByRole('heading', { name: 'Welcome to SME Finance' });
  query.setQueryData(['private-account'], 'old data');
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByLabelText('Email address');
  expect(router.state.location.pathname).toBe('/login');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled());
  expect(query.getQueryData(['private-account'])).toBeUndefined();
});
