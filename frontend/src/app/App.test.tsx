import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { createSession } from '../auth/session';
import { server } from '../test/server';
import { apiRoot, authHandlers } from '../test/auth-fixtures';
import { ErrorBoundary } from '../components/states/ErrorBoundary';
import { routes } from '../routes/routes';
import { createQueryClient } from './query-client';
import { App } from './App';

beforeEach(() => server.use(...authHandlers()));
it('bootstraps the application with providers and navigates to sign-in', async () => {
  render(<App />);
  expect(
    await screen.findByRole('heading', { name: /Clarity for your next chapter/i }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('link', { name: /Sign in/i })[1]!);
  expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
});

it.each(['/404', '/missing/deep/path'])('renders a safe not-found route for %s', async (path) => {
  const query = createQueryClient();
  const session = createSession(query, apiRoot);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ErrorBoundary>
      <QueryClientProvider client={query}>
        <AuthProvider session={session}>
          <RouterProvider router={router} onError={() => undefined} />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>,
  );
  expect(await screen.findByRole('heading', { name: 'A little off course.' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Sign in/i })).toHaveAttribute('href', '/login');
  await userEvent.click(screen.getByRole('link', { name: /Return to workspace/i }));
  expect(
    await screen.findByRole('heading', { name: /Clarity for your next chapter/i }),
  ).toBeInTheDocument();
  router.dispose();
  query.clear();
});

it('contains render failures without showing exception details', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  function Broken(): never {
    throw new Error('private render state');
  }
  render(
    <ErrorBoundary>
      <Broken />
    </ErrorBoundary>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Reload the application');
  expect(screen.queryByText('private render state')).not.toBeInTheDocument();
});
