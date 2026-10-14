import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { simulateApi, org } from './fixtures';

for (const width of [390, 1280]) {
  test(`organization onboarding: empty workspace to verified Dashboard at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await simulateApi(page);
    let created = false;
    await page.route('http://localhost:3000/api/v1/organizations', async (route) => {
      if (route.request().method() === 'POST') {
        expect(route.request().postDataJSON()).toEqual({
          legalName: 'Browser business',
          baseCurrency: 'USD',
          timezone: 'UTC',
        });
        created = true;
        await route.fulfill({ status: 201, json: { data: org } });
      } else await route.fulfill({ json: { data: created ? [org] : [] } });
    });
    await page.goto('/workspace');
    await expect(page.getByRole('heading', { name: 'No organizations yet' })).toBeVisible();
    await page.getByRole('link', { name: 'Create Organization' }).click();
    await page.getByRole('button', { name: 'Create Organization' }).click();
    await expect(page.getByText('Enter the legal business name.')).toBeVisible();
    await page.getByLabel('Legal business name').fill('Browser business');
    await page.getByLabel('Base currency').fill('USD');
    await page.getByLabel('Timezone', { exact: true }).fill('UTC');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`organization-form-${width}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Create Organization' }).click();
    await expect(page).toHaveURL(new RegExp(`/organizations/${org.id}/dashboard$`));
    await expect(page.getByRole('heading', { name: 'Financial overview' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Organization' })).toHaveValue(org.id);
    if (width < 768) await page.getByRole('button', { name: 'Open navigation' }).click();
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
  });
}
