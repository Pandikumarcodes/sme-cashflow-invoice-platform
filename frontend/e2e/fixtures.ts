import { expect, type Page } from '@playwright/test';
import { testUser, tokenResponse } from '../src/test/auth-fixtures';
import {
  dashboardOrg,
  secondOrg,
  cashFixture,
  summaryFixture,
} from '../src/features/dashboard/test-fixtures';
import { profitReport, agingReport } from '../src/features/financials/test-fixtures';
import { invoiceFixture, paymentFixture } from '../src/features/payments/test-fixtures';
import { categoryFixture, expenseFixture } from '../src/features/expenses/test-fixtures';
import { notification } from '../src/features/notifications/test-fixtures';
import {
  auditFixture,
  exportFixture,
  page as listPage,
  exportId,
} from '../src/features/reports/test-fixtures';

export const org = dashboardOrg;
export const other = secondOrg;
export const customer = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  organizationId: org.id,
  displayName: 'Customer Alpha',
  customerCode: null,
  email: 'customer@example.test',
  status: 'ACTIVE',
  createdByUserId: testUser.id,
  version: 1,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

// Browser-only transport simulation. These fixtures never create database rows or bypass server auth.
export async function simulateApi(browser: Page, signedIn = true) {
  let authenticated = signedIn;
  let notice = notification();
  await browser.route('http://localhost:3000/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const send = (body: unknown, status = 200, headers = {}) =>
      route.fulfill({
        status,
        json: body,
        headers: {
          'Access-Control-Expose-Headers': 'ETag, X-Request-Id, Idempotency-Replayed',
          ...headers,
        },
      });
    const denied = () =>
      send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } }, 401);
    if (path === '/auth/refresh') return authenticated ? send(tokenResponse()) : denied();
    if (path === '/auth/login') {
      authenticated = true;
      return send({ data: { ...tokenResponse().data, user: testUser } });
    }
    if (path === '/auth/logout') {
      authenticated = false;
      return route.fulfill({ status: 204 });
    }
    if (!authenticated) return denied();
    expect(route.request().headers().authorization).toBe('Bearer memory-access-token');
    if (path === '/me') return send({ data: testUser });
    if (path === '/organizations') return send({ data: [org, other] });
    if (path === `/organizations/${org.id}`) return send({ data: org });
    if (path === `/organizations/${other.id}`) return send({ data: other });
    const suffix = path.replace(`/organizations/${org.id}/`, '');
    const range = {
      fromDate: url.searchParams.get('fromDate') ?? '2026-10-01',
      toDate: url.searchParams.get('toDate') ?? '2026-10-31',
      asOfDate: url.searchParams.get('asOfDate') ?? '2026-10-12',
    };
    const limit = Number(url.searchParams.get('limit') ?? 25);
    if (suffix === 'analytics/summary') return send(summaryFixture(range));
    if (suffix === 'cash-flow') return send(cashFixture(range));
    if (suffix === 'profit-loss') return send(profitReport(range));
    if (suffix === 'analytics/receivables-aging') return send(agingReport(range.asOfDate));
    if (suffix === 'customers') return send(listPage([customer], limit));
    if (suffix === `customers/${customer.id}`)
      return send({ data: customer }, 200, { ETag: '"1"' });
    if (suffix === 'invoices') return send(listPage([invoiceFixture()], limit));
    if (suffix === `invoices/${invoiceFixture().id}`)
      return send({ data: invoiceFixture() }, 200, { ETag: '"3"' });
    if (suffix === 'payments') return send(listPage([paymentFixture()], limit));
    if (suffix === `payments/${paymentFixture().id}`) return send({ data: paymentFixture() });
    if (suffix === 'expense-categories') return send(listPage([categoryFixture()], limit));
    if (suffix === 'expenses') return send(listPage([expenseFixture()], limit));
    if (suffix === `expenses/${expenseFixture().id}`)
      return send({ data: expenseFixture() }, 200, { ETag: '"3"' });
    if (suffix === 'notifications')
      return send(listPage(notice.status === 'ARCHIVED' ? [] : [notice], limit));
    if (suffix === `notifications/${notice.id}/read`) {
      notice = { ...notice, status: 'READ', readAt: notice.createdAt };
      return send({ data: notice });
    }
    if (suffix === `notifications/${notice.id}/archive`) {
      notice = { ...notice, status: 'ARCHIVED', archivedAt: notice.createdAt };
      return send({ data: notice });
    }
    if (suffix === 'audit-logs') return send(listPage([auditFixture()], limit));
    if (suffix === 'report-exports')
      return send(
        listPage(
          [
            exportFixture({
              status: 'READY',
              rowCount: '1',
              completedAt: '2026-10-12T10:00:00.000Z',
              expiresAt: '2099-10-13T10:00:00.000Z',
            }),
          ],
          limit,
        ),
      );
    if (suffix === `report-exports/${exportId}/download`)
      return route.fulfill({
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        body: 'invoice_number,total\r\nINV-00001,100.00\r\n',
      });
    if (suffix.startsWith('reports/')) {
      const parameters = Object.fromEntries(
        [...url.searchParams].filter(([key]) => !['limit', 'after'].includes(key)),
      );
      return send({
        data: [],
        meta: {
          ...parameters,
          currency: 'USD',
          timezone: 'UTC',
          basis: 'CURRENT_STATE',
          limit,
          hasMore: false,
          nextCursor: null,
        },
      });
    }
    throw new Error(`Unconfigured browser fixture: ${route.request().method()} ${path}`);
  });
}
