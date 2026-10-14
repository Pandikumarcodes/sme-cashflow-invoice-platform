import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

test('new account creates its first organization and opens the authorized Dashboard', async ({
  page,
  playwright,
}) => {
  test.setTimeout(90_000);
  const api = await playwright.request.newContext({ baseURL: 'http://localhost:3001/api/v1/' });
  const email = `onboarding-${randomUUID()}@example.test`;
  const password = `Onboarding-${randomUUID()}!`;
  try {
    expect(
      (
        await api.post('organizations', {
          data: { legalName: 'Unauthorized', baseCurrency: 'USD', timezone: 'UTC' },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await api.post('auth/register', {
          data: { email, password, firstName: 'Onboarding', lastName: 'Test' },
        })
      ).status(),
    ).toBe(201);
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/session$/);
    await page.goto('/workspace');
    await expect(page.getByRole('heading', { name: 'No organizations yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Create Organization' }).click();
    await page.getByLabel('Legal business name').fill('Onboarding business');
    await page.getByLabel('Base currency').fill('USD');
    await page.getByLabel('Timezone', { exact: true }).fill('UTC');
    await page.getByRole('button', { name: 'Create Organization' }).click();
    await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]+\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Financial overview' })).toBeVisible();
    const id = page.url().split('/')[4];
    await expect(page.getByRole('combobox', { name: 'Organization' })).toHaveValue(id!);
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
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Financial overview' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Organization' })).toHaveValue(id!);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toHaveCount(0);
  } finally {
    await api.dispose();
  }
});
