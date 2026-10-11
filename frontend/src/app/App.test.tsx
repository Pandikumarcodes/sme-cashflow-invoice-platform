import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { authHandlers } from '../test/auth-fixtures';
import { ErrorBoundary } from '../components/states/ErrorBoundary';
import { routes } from '../routes/routes';
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
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole('heading', { name: 'A little off course.' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: /Return to workspace/i }));
  expect(
    await screen.findByRole('heading', { name: /Clarity for your next chapter/i }),
  ).toBeInTheDocument();
  router.dispose();
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
