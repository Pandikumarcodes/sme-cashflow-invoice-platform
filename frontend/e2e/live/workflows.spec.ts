import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';
import type { APIRequestContext } from '@playwright/test';

test('live guarded backend: financial workflow, isolation, worker exports and browser session', async ({
  page,
  createApi,
}, testInfo) => {
  test.setTimeout(240_000);
  const api = await createApi();
  const outsider = await createApi();
  const run = randomUUID();
  const email = `frontend-${run}@example.test`;
  const password = `Readiness-${randomUUID()}!`;
  async function account(context: APIRequestContext, address: string) {
    const registered = await context.post('auth/register', {
      data: { email: address, password, firstName: 'Readiness', lastName: 'Test' },
    });
    expect(
      registered.status(),
      `registration requestId=${registered.headers()['x-request-id'] ?? 'unavailable'}`,
    ).toBe(201);
    const login = await context.post('auth/login', { data: { email: address, password } });
    expect(login.status()).toBe(200);
    return (await login.json()).data.accessToken as string;
  }
  const token = await account(api, email);
  const otherToken = await account(outsider, `outsider-${run}@example.test`);
  const headers = { Authorization: `Bearer ${token}` };
  async function organization(name: string) {
    const response = await api.post('organizations', {
      headers,
      data: {
        legalName: `${name} ${run}`,
        displayName: name,
        baseCurrency: 'USD',
        timezone: 'UTC',
      },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).data;
  }
  const a = await organization('Readiness Alpha');
  const b = await organization('Readiness Beta');
  const base = `organizations/${a.id}`;
  const customerResponse = await api.post(`${base}/customers`, {
    headers,
    data: { displayName: 'Readiness customer', email: 'customer@example.test' },
  });
  expect(customerResponse.status()).toBe(201);
  const customer = (await customerResponse.json()).data;
  const updatedCustomer = await api.patch(`${base}/customers/${customer.id}`, {
    headers: { ...headers, 'If-Match': customerResponse.headers().etag! },
    data: { displayName: 'Verified customer' },
  });
  expect(updatedCustomer.status()).toBe(200);
  expect(
    (
      await api.patch(`${base}/customers/${customer.id}`, {
        headers: { ...headers, 'If-Match': '"1"' },
        data: { displayName: 'Stale change' },
      })
    ).status(),
  ).toBe(409);
  expect(
    (await api.get(`organizations/${b.id}/customers/${customer.id}`, { headers })).status(),
  ).toBe(404);
  expect(
    (await outsider.get(base, { headers: { Authorization: `Bearer ${otherToken}` } })).status(),
  ).toBe(404);
  const draftResponse = await api.post(`${base}/invoices`, {
    headers,
    data: {
      customerId: customer.id,
      issueDate: '2026-10-01',
      dueDate: '2026-10-31',
      discount: { type: 'NONE', value: '0' },
      taxRate: '0',
      items: [
        { description: 'Verified consulting', quantity: '1', unitPrice: '100.10', sortOrder: 0 },
      ],
    },
  });
  expect(draftResponse.status()).toBe(201);
  const draft = (await draftResponse.json()).data;
  expect(draft.total).toBe('100.10');
  const issuedResponse = await api.post(`${base}/invoices/${draft.id}/issue`, {
    headers: { ...headers, 'If-Match': draftResponse.headers().etag! },
    data: {},
  });
  expect(issuedResponse.status()).toBe(200);
  const invoice = (await issuedResponse.json()).data;
  expect(invoice.status).toBe('ISSUED');
  expect(invoice.invoiceNumber).toBeTruthy();
  expect(
    (
      await api.patch(`${base}/invoices/${invoice.id}`, {
        headers: { ...headers, 'If-Match': issuedResponse.headers().etag! },
        data: { taxRate: '0.1' },
      })
    ).status(),
  ).toBe(409);
  const paymentKey = randomUUID();
  const paymentBody = { amount: '100.10', paymentDate: '2026-10-02', method: 'BANK_TRANSFER' };
  const paymentResponse = await api.post(`${base}/invoices/${invoice.id}/payments`, {
    headers: { ...headers, 'Idempotency-Key': paymentKey },
    data: paymentBody,
  });
  expect(paymentResponse.status()).toBe(201);
  const payment = (await paymentResponse.json()).data;
  expect(payment.invoice.balanceDue).toBe('0.00');
  const replay = await api.post(`${base}/invoices/${invoice.id}/payments`, {
    headers: { ...headers, 'Idempotency-Key': paymentKey },
    data: paymentBody,
  });
  expect(replay.status()).toBe(201);
  expect((await replay.json()).data.id).toBe(payment.id);
  expect(replay.headers()['idempotency-replayed']).toBe('true');
  expect(
    (
      await api.post(`${base}/invoices/${invoice.id}/payments`, {
        headers: { ...headers, 'Idempotency-Key': paymentKey },
        data: { ...paymentBody, amount: '1.00' },
      })
    ).status(),
  ).toBe(409);
  const reversalKey = randomUUID();
  const reversal = await api.post(`${base}/payments/${payment.id}/reverse`, {
    headers: { ...headers, 'Idempotency-Key': reversalKey },
    data: { reason: 'Readiness full reversal', reversalDate: '2026-10-03' },
  });
  expect(reversal.status()).toBe(200);
  expect((await reversal.json()).data.invoice.balanceDue).toBe('100.10');
  const originalReceipt = await api.post(`${base}/invoices/${invoice.id}/payments`, {
    headers: { ...headers, 'Idempotency-Key': paymentKey },
    data: paymentBody,
  });
  expect(originalReceipt.status()).toBe(201);
  expect((await originalReceipt.json()).data.invoice.balanceDue).toBe('0.00');
  expect(
    (await api.get(`organizations/${b.id}/invoices/${invoice.id}`, { headers })).status(),
  ).toBe(404);
  expect(
    (await api.get(`organizations/${b.id}/payments/${payment.id}`, { headers })).status(),
  ).toBe(404);
  const categoryResponse = await api.post(`${base}/expense-categories`, {
    headers,
    data: { name: 'Readiness utilities' },
  });
  expect(categoryResponse.status()).toBe(201);
  const category = (await categoryResponse.json()).data;
  const expenseResponse = await api.post(`${base}/expenses`, {
    headers,
    data: {
      categoryId: category.id,
      amount: '40.05',
      expenseDate: '2026-10-02',
      description: 'Verified expense',
    },
  });
  expect(expenseResponse.status()).toBe(201);
  const expense = (await expenseResponse.json()).data;
  const period = { fromDate: '2026-10-01', toDate: '2026-10-31' };
  const cash = await api.get(`${base}/cash-flow`, { headers, params: period });
  expect(cash.status()).toBe(200);
  expect((await cash.json()).data).toMatchObject({
    inflows: '0.00',
    outflows: '40.05',
    netCashFlow: '-40.05',
  });
  expect(
    (await api.get(`organizations/${b.id}/expenses/${expense.id}`, { headers })).status(),
  ).toBe(404);
  const otherCash = await api.get(`organizations/${b.id}/cash-flow`, { headers, params: period });
  expect((await otherCash.json()).data.outflows).toBe('0.00');
  const profit = await api.get(`${base}/profit-loss`, { headers, params: period });
  expect((await profit.json()).data).toMatchObject({
    revenue: '0.00',
    expenses: '40.05',
    netResult: '-40.05',
  });
  const aging = await api.get(`${base}/analytics/receivables-aging`, {
    headers,
    params: { asOfDate: '2026-10-12' },
  });
  expect((await aging.json()).data.outstanding).toBe('100.10');
  const otherAging = await api.get(`organizations/${b.id}/analytics/receivables-aging`, {
    headers,
    params: { asOfDate: '2026-10-12' },
  });
  expect((await otherAging.json()).data.outstanding).toBe('0.00');
  const voided = await api.post(`${base}/expenses/${expense.id}/void`, {
    headers: { ...headers, 'If-Match': expenseResponse.headers().etag! },
    data: { reason: 'Readiness void' },
  });
  expect(voided.status()).toBe(200);
  expect(
    (await (await api.get(`${base}/cash-flow`, { headers, params: period })).json()).data.outflows,
  ).toBe('0.00');
  const archive = await api.post(`${base}/customers/${customer.id}/archive`, { headers, data: {} });
  expect(archive.status()).toBe(200);
  expect((await archive.json()).data.status).toBe('ARCHIVED');
  for (const type of ['invoices', 'payments', 'expenses', 'receivables']) {
    const preview = await api.get(`${base}/reports/${type}`, { headers });
    expect(preview.status()).toBe(200);
    expect((await preview.json()).meta.currency).toBe('USD');
  }
  const exports: string[] = [];
  for (const reportType of [
    'INVOICE_REGISTER',
    'PAYMENT_REGISTER',
    'EXPENSE_REGISTER',
    'RECEIVABLES',
    'CASH_FLOW',
    'CASH_BASIS_PERFORMANCE',
  ]) {
    const key = randomUUID();
    const body = {
      reportType,
      format: 'CSV',
      parameters: reportType === 'RECEIVABLES' ? { asOfDate: '2026-10-12' } : period,
    };
    const created = await api.post(`${base}/reports/exports`, {
      headers: { ...headers, 'Idempotency-Key': key },
      data: body,
    });
    expect(created.status()).toBe(202);
    const id = (await created.json()).data.id as string;
    exports.push(id);
    const repeated = await api.post(`${base}/reports/exports`, {
      headers: { ...headers, 'Idempotency-Key': key },
      data: body,
    });
    expect(repeated.status()).toBe(202);
    expect((await repeated.json()).data.id).toBe(id);
    await expect
      .poll(
        async () =>
          (await (await api.get(`${base}/report-exports/${id}`, { headers })).json()).data.status,
        { timeout: 30_000 },
      )
      .toBe('READY');
    const download = await api.get(`${base}/report-exports/${id}/download`, { headers });
    expect(download.status()).toBe(200);
    expect(download.headers()['content-type']).toContain('text/csv');
    const csv = await download.text();
    expect(csv.includes('\r\n')).toBe(true);
    if (reportType === 'INVOICE_REGISTER' || reportType === 'RECEIVABLES')
      expect(csv.includes('100.10')).toBe(true);
    expect(
      (await api.get(`organizations/${b.id}/report-exports/${id}/download`, { headers })).status(),
    ).toBe(404);
  }
  const audit = await api.get(`${base}/audit-logs`, { headers, params: { limit: 100 } });
  expect(audit.status()).toBe(200);
  expect((await audit.json()).data.length).toBeGreaterThan(0);
  const auditPage = await (
    await api.get(`${base}/audit-logs`, { headers, params: { limit: 1 } })
  ).json();
  expect(auditPage.meta.hasMore).toBe(true);
  const nextAudit = await api.get(`${base}/audit-logs`, {
    headers,
    params: { limit: 1, after: auditPage.meta.nextCursor },
  });
  expect(nextAudit.status()).toBe(200);
  expect((await nextAudit.json()).data[0].id).not.toBe(auditPage.data[0].id);
  const inbox = await api.get(`${base}/notifications`, { headers });
  expect(inbox.status()).toBe(200);
  const notices = (await inbox.json()).data;
  expect(notices.length).toBeGreaterThan(0);
  const noticeId = notices[0].id;
  expect(
    (
      await api.post(`organizations/${b.id}/notifications/${noticeId}/read`, { headers, data: {} })
    ).status(),
  ).toBe(404);
  const readNotice = await api.post(`${base}/notifications/${noticeId}/read`, {
    headers,
    data: {},
  });
  expect(readNotice.status()).toBe(200);
  expect((await readNotice.json()).data.status).toBe('READ');
  const archivedNotice = await api.post(`${base}/notifications/${noticeId}/archive`, {
    headers,
    data: {},
  });
  expect(archivedNotice.status()).toBe(200);
  expect((await archivedNotice.json()).data.status).toBe('ARCHIVED');
  const otherHeaders = { Authorization: `Bearer ${otherToken}` };
  const invitation = await api.post(`${base}/invitations`, {
    headers,
    data: { email: `outsider-${run}@example.test`, role: 'MEMBER' },
  });
  expect(invitation.status()).toBe(201);
  const accepted = await outsider.post('invitations/accept', {
    headers: otherHeaders,
    data: { token: (await invitation.json()).data.delivery.token },
  });
  expect(accepted.status()).toBe(200);
  expect((await outsider.get(`${base}/payments`, { headers: otherHeaders })).status()).toBe(403);
  expect((await outsider.get(`${base}/audit-logs`, { headers: otherHeaders })).status()).toBe(403);
  expect(
    (
      await outsider.get(`${base}/report-exports/${exports[0]}/download`, { headers: otherHeaders })
    ).status(),
  ).toBe(403);
  expect(
    (
      await outsider.post(`${base}/notifications/${noticeId}/read`, {
        headers: otherHeaders,
        data: {},
      })
    ).status(),
  ).toBe(404);
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Incorrect-readiness-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('email or password is incorrect');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Navigation must not interrupt the backend's cookie-setting login operation.
  await expect(page).toHaveURL(/\/session$/);
  await page.goto(`/organizations/${a.id}/workspace`);
  await expect(page.getByRole('heading', { name: 'Readiness Alpha', exact: true })).toBeVisible();
  const cookie = (await page.context().cookies()).find(
    (row) => row.name === 'sme_readiness_refresh',
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Readiness Alpha', exact: true })).toBeVisible();
  for (const [path, heading] of [
    ['customers?status=ARCHIVED', 'Customers'],
    [`invoices/${invoice.id}`, invoice.invoiceNumber],
    ['payments', 'Payments'],
    ['expenses?status=VOIDED', 'Expenses'],
    ['cash-flow?fromDate=2026-10-01&toDate=2026-10-31', 'Cash Flow'],
    ['profit-loss?fromDate=2026-10-01&toDate=2026-10-31', 'Profit & Loss'],
    ['receivables-aging?asOfDate=2026-10-12', 'Receivables Aging'],
    ['notifications', 'Notifications'],
    ['reports', 'Reports'],
    ['audit-logs', 'Audit Logs'],
  ]) {
    await page.goto(`/organizations/${a.id}/${path}`);
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    if (path.startsWith('invoices/')) await expect(page.locator('main')).toContainText('$100.10');
    if (path.startsWith('cash-flow') || path.startsWith('profit-loss'))
      await expect(page.locator('main')).toContainText('$0.00');
    if (path.startsWith('receivables-aging'))
      await expect(page.locator('main')).toContainText('$100.10');
  }
  await page.goto(`/organizations/${a.id}/reports`);
  await page.getByRole('button', { name: 'Refresh export history', exact: true }).click();
  await page.getByRole('button', { name: `Inspect export ${exports[0]}`, exact: true }).click();
  await page.getByRole('button', { name: 'Refresh export status', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Export status' })).toContainText('READY');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: `Download CSV ${exports[0]}`, exact: true }).click();
  expect((await downloadEvent).suggestedFilename()).toBe(`report-${exports[0]}.csv`);
  await page.getByRole('combobox', { name: 'Organization' }).selectOption(b.id);
  await expect(page.getByText('No exports available yet.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('live-tenant-switch.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(`/organizations/${a.id}/reports`);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email address').fill(`outsider-${run}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/organizations/${a.id}/reports$`));
  await expect(page.getByRole('alert')).toContainText('Access denied');
  await expect(page.getByRole('button', { name: /Download CSV/ })).toHaveCount(0);
  const revoke = await outsider.post('auth/logout-all', { headers: otherHeaders, data: {} });
  expect(revoke.status()).toBe(204);
  await page.goto(`/organizations/${a.id}/customers`);
  await expect(page).toHaveURL(/\/login$/);
});

test('live guarded backend: browser forms create customer, issue invoice, record payment, expense and CSV', async ({
  page,
  createApi,
}, testInfo) => {
  test.setTimeout(180_000);
  const api = await createApi();
  const run = randomUUID();
  const email = `browser-${run}@example.test`;
  const password = `Browser-${randomUUID()}!`;
  expect(
    (
      await api.post('auth/register', {
        data: { email, password, firstName: 'Browser', lastName: 'Test' },
      })
    ).status(),
  ).toBe(201);
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const loginResponse = page.waitForResponse(
    (response) => response.url().endsWith('/auth/login') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const login = await loginResponse;
  expect(login.status()).toBe(200);
  const token = (await login.json()).data.accessToken as string;
  await expect(page).toHaveURL(/\/session$/);
  const headers = { Authorization: `Bearer ${token}` };
  await page.goto('/workspace');
  await expect(page.getByRole('heading', { name: 'No organizations yet' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Payments', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Create Organization', exact: true }).click();
  await page.getByLabel('Legal business name', { exact: true }).fill(`Browser ${run}`);
  await page.getByLabel('Base currency', { exact: true }).fill('USD');
  await page.getByLabel('Timezone', { exact: true }).fill('UTC');
  const organizationResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/organizations' &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create Organization', exact: true }).click();
  const organization = await organizationResponse;
  expect(organization.status()).toBe(201);
  const createdOrganization = (await organization.json()).data;
  const orgId = createdOrganization.id as string;
  expect(createdOrganization.membership.status).toBe('ACTIVE');
  expect(createdOrganization.membership.role).toBe('OWNER');
  await expect(page).toHaveURL(new RegExp(`/organizations/${orgId}/dashboard$`));
  await expect(
    page.getByRole('heading', { name: 'Financial overview', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Organization' })).toHaveValue(orgId);
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
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  const category = await api.post(`organizations/${orgId}/expense-categories`, {
    headers,
    data: { name: 'Browser utilities' },
  });
  expect(category.status()).toBe(201);
  const categoryId = (await category.json()).data.id as string;
  const base = `/organizations/${orgId}`;
  const responseFor = (suffix: string) =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith(`/organizations/${orgId}/${suffix}`) &&
        response.request().method() === 'POST',
    );

  await page.goto(`${base}/customers/new`);
  await page.getByLabel('Display name', { exact: true }).fill('Browser customer');
  const customerResponse = responseFor('customers');
  await page.getByRole('button', { name: 'Create customer', exact: true }).click();
  expect((await customerResponse).status()).toBe(201);
  await expect(page.getByRole('heading', { name: 'Browser customer', exact: true })).toBeVisible();
  const customerId = (await (await customerResponse).json()).data.id as string;

  await page.goto(`${base}/invoices/new`);
  await page.getByLabel('Invoice customer', { exact: true }).selectOption(customerId);
  await page.getByLabel('Invoice date', { exact: true }).fill('2026-10-01');
  await page.getByLabel('Due date', { exact: true }).fill('2026-10-31');
  await page.getByLabel('Description 1', { exact: true }).fill('Browser consulting');
  await page.getByLabel('Unit price 1', { exact: true }).fill('100.10');
  const draftResponse = responseFor('invoices');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  const draft = await draftResponse;
  expect(draft.status()).toBe(201);
  const invoiceId = (await draft.json()).data.id as string;
  await page.getByRole('button', { name: 'Issue invoice', exact: true }).click();
  const issuedResponse = responseFor(`invoices/${invoiceId}/issue`);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm issue invoice', exact: true })
    .click();
  expect((await issuedResponse).status()).toBe(200);
  await page.getByRole('link', { name: 'Record payment', exact: true }).click();
  await page.getByLabel('Payment amount (USD)', { exact: true }).fill('100.10');
  await page.getByLabel('Payment date', { exact: true }).fill('2026-10-02');
  const paidResponse = responseFor(`invoices/${invoiceId}/payments`);
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  const paid = await paidResponse;
  expect(paid.status()).toBe(201);
  expect((await paid.json()).data.invoice.balanceDue).toBe('0.00');
  await expect(page.getByRole('heading', { name: 'Payment recording confirmed' })).toBeVisible();

  await page.goto(`${base}/expenses/new`);
  await page.getByLabel('Select expense category', { exact: true }).selectOption(categoryId);
  await page.getByLabel('Expense amount (USD)', { exact: true }).fill('40.05');
  await page.getByLabel('Expense date', { exact: true }).fill('2026-10-02');
  await page.getByLabel('Expense description', { exact: true }).fill('Browser expense');
  const expenseResponse = responseFor('expenses');
  const expenseDetails = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname.startsWith(`/api/v1/organizations/${orgId}/expenses/`),
  );
  await page.getByRole('button', { name: 'Record expense', exact: true }).click();
  expect((await expenseResponse).status()).toBe(201);
  expect((await expenseDetails).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Expense details', exact: true })).toBeVisible();

  for (const path of ['cash-flow', 'profit-loss']) {
    await page.goto(`${base}/${path}?fromDate=2026-10-01&toDate=2026-10-31`);
    const summary = page.getByRole('region', { name: 'Financial report summary' });
    for (const amount of ['$100.10', '$40.05', '$60.05'])
      await expect(summary).toContainText(amount);
  }
  await page.goto(`${base}/reports`);
  const requestedResponse = responseFor('reports/exports');
  await page.getByRole('button', { name: 'Request CSV export', exact: true }).click();
  const requested = await requestedResponse;
  expect(requested.status()).toBe(202);
  const exportId = (await requested.json()).data.id as string;
  await expect(page).toHaveURL(new RegExp(`exportId=${exportId}`));
  const status = page.getByRole('region', { name: 'Export status' });
  await expect
    .poll(
      async () => {
        const refresh = page.getByRole('button', { name: 'Refresh export status', exact: true });
        await refresh.click();
        await expect(refresh).toBeEnabled();
        return await status.getByText('Status: READY', { exact: true }).count();
      },
      { timeout: 30_000 },
    )
    .toBe(1);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download selected CSV', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(`report-${exportId}.csv`);
  const stream = await download.createReadStream();
  expect(stream !== null).toBe(true);
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString('utf8').includes('100.10')).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('live-browser-report-390.png'),
    fullPage: true,
  });
});
