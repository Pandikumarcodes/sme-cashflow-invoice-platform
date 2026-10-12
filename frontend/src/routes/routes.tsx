import type { RouteObject } from 'react-router-dom';
import { FoundationLayout } from '../components/layout/FoundationLayout';
import { RouteError } from '../components/states/RouteError';
import { FoundationPage } from '../features/foundation/FoundationPage';
import { NotFoundPage } from '../features/foundation/PlaceholderPage';
import { LoginPage, RegisterPage, SessionPage } from '../features/auth/AuthPages';
import { ProtectedRoute, SessionLoading } from '../auth/ProtectedRoute';
import { OrganizationShell, OrganizationWorkspace } from '../organizations/Workspace';

export const routes: RouteObject[] = [
  {
    element: <ProtectedRoute />,
    hydrateFallbackElement: <SessionLoading />,
    errorElement: <RouteError />,
    children: [
      {
        element: <OrganizationShell />,
        children: [
          ...(
            [
              ['cash-flow', 'CashFlowPage'],
              ['profit-loss', 'ProfitLossPage'],
            ] as const
          ).map(([path, page]) => ({
            path: `/organizations/:organizationId/${path}`,
            lazy: async () => ({
              Component: (await import('../features/financials/FinancialPages'))[page],
            }),
          })),
          {
            path: '/organizations/:organizationId/receivables-aging',
            lazy: async () => ({
              Component: (await import('../features/analytics/AgingPage')).AgingPage,
            }),
          },
          ...(
            [
              ['expenses', 'ExpenseListPage'],
              ['expenses/new', 'ExpenseCreatePage'],
              ['expenses/:expenseId', 'ExpenseDetailsPage'],
              ['expenses/:expenseId/edit', 'ExpenseEditPage'],
            ] as const
          ).map(([path, page]) => ({
            path: `/organizations/:organizationId/${path}`,
            lazy: async () => ({
              Component: (await import('../features/expenses/ExpensePages'))[page],
            }),
          })),
          {
            path: '/organizations/:organizationId/expense-categories',
            lazy: async () => ({
              Component: (await import('../features/expenses/CategoriesPage')).CategoriesPage,
            }),
          },
          ...(
            [
              ['payments', 'PaymentListPage'],
              ['payments/new', 'PaymentCreatePage'],
              ['payments/:paymentId', 'PaymentDetailsPage'],
            ] as const
          ).map(([path, page]) => ({
            path: `/organizations/:organizationId/${path}`,
            lazy: async () => ({
              Component: (await import('../features/payments/PaymentPages'))[page],
            }),
          })),
          ...(
            [
              ['invoices', 'InvoiceListPage'],
              ['invoices/new', 'InvoiceCreatePage'],
              ['invoices/:invoiceId', 'InvoiceDetailsPage'],
              ['invoices/:invoiceId/edit', 'InvoiceEditPage'],
            ] as const
          ).map(([path, page]) => ({
            path: `/organizations/:organizationId/${path}`,
            lazy: async () => ({
              Component: (await import('../features/invoices/InvoicePages'))[page],
            }),
          })),
          ...(
            [
              ['customers', 'CustomersListPage'],
              ['customers/new', 'CustomerCreatePage'],
              ['customers/:customerId', 'CustomerDetailsPage'],
              ['customers/:customerId/edit', 'CustomerEditPage'],
            ] as const
          ).map(([path, page]) => ({
            path: `/organizations/:organizationId/${path}`,
            lazy: async () => ({
              Component: (await import('../features/customers/CustomersPages'))[page],
            }),
          })),
          { path: '/workspace', element: <OrganizationWorkspace /> },
          { path: '/organizations/:organizationId/workspace', element: <OrganizationWorkspace /> },
          {
            path: '/organizations/:organizationId/dashboard',
            lazy: async () => ({
              Component: (await import('../features/dashboard/DashboardPage')).default,
            }),
          },
        ],
      },
    ],
  },
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
