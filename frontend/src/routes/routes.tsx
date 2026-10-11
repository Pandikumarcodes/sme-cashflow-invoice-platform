import type { RouteObject } from 'react-router-dom';
import { FoundationLayout } from '../components/layout/FoundationLayout';
import { RouteError } from '../components/states/RouteError';
import { FoundationPage } from '../features/foundation/FoundationPage';
import { NotFoundPage } from '../features/foundation/PlaceholderPage';
import { LoginPage, RegisterPage, SessionPage } from '../features/auth/AuthPages';
import { ProtectedRoute } from '../auth/ProtectedRoute';

export const routes: RouteObject[] = [
  {
    element: <FoundationLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <FoundationPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { element: <ProtectedRoute />, children: [{ path: '/session', element: <SessionPage /> }] },
      { path: '/404', element: <NotFoundPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
