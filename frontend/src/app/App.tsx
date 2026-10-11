import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { environment } from '../lib/env';
import { createSession } from '../auth/session';
import { AuthProvider } from '../auth/AuthProvider';
import { routes } from '../routes/routes';
import { ErrorBoundary } from '../components/states/ErrorBoundary';
import { createQueryClient } from './query-client';

const router = createBrowserRouter(routes);
const queryClient = createQueryClient();
const session = createSession(queryClient, environment.apiBaseUrl);

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider session={session}>
          <RouterProvider
            router={router}
            onError={() => {
              // Route error elements display safe messages; never log raw exceptions.
            }}
          />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
