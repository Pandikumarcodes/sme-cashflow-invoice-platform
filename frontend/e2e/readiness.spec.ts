import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { simulateApi, org, other, customer } from './fixtures';
import { invoiceFixture, paymentFixture } from '../src/features/payments/test-fixtures';
import { expenseFixture } from '../src/features/expenses/test-fixtures';
import { exportId } from '../src/features/reports/test-fixtures';

const routes = [
  ['workspace', 'Alpha'],
  ['dashboard', 'Financial overview'],
  ['customers', 'Customers'],
  ['customers/new', 'Add customer'],
  [`customers/${customer.id}`, 'Customer Alpha'],
  ['invoices', 'Invoices'],
  ['invoices/new', 'Create invoice'],
  [`invoices/${invoiceFixture().id}`, 'INV-00001'],
  ['payments', 'Payments'],
  ['payments/new', 'Record payment'],
  [`payments/${paymentFixture().id}`, 'Payment details'],
  ['expenses', 'Expenses'],
  ['expenses/new', 'Record expense'],
  [`expenses/${expenseFixture().id}`, 'Expense details'],
  ['expense-categories', 'Expense categories'],
  ['cash-flow', 'Cash Flow'],
  ['profit-loss', 'Profit & Loss'],
  ['receivables-aging', 'Receivables Aging'],
  ['notifications', 'Notifications'],
  ['reports', 'Reports'],
  ['audit-logs', 'Audit Logs'],
] as const;

for (const width of [320, 375, 390, 768, 1024, 1280, 1440, 1920]) {
  test(`simulated API: route reflow and accessibility at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await simulateApi(page);
    for (const [path, heading] of routes) {
      await page.goto(`/organizations/${org.id}/${path}`);
      await expect(
        page.getByRole('heading', { level: 1, name: heading, exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/^(Loading|Checking).*…$/)).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
      if (path === 'payments' || path === 'expenses') {
        await expect(page.getByRole('columnheader', { name: 'Amount', exact: true })).toHaveCount(
          1,
        );
      }
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        scan.violations,
        `${path}: ${JSON.stringify(scan.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })))}`,
      ).toEqual([]);
    }
    await page.screenshot({ path: testInfo.outputPath(`audit-${width}.png`), fullPage: true });
  });
}

test('simulated API: sign-in, recovery, logout and protected navigation', async ({ page }) => {
  await simulateApi(page, false);
  await page.goto(`/organizations/${org.id}/workspace`);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email address').fill('alex@example.test');
  await page.getByLabel('Password', { exact: true }).fill('browser-fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.values(localStorage).some((value) => value.includes('memory-access-token')),
    ),
  ).toBe(false);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(`/organizations/${org.id}/reports`);
  await expect(page).toHaveURL(/\/login$/);
});

test('simulated API: public forms, reduced motion and 200% effective reflow', async ({
  page,
}, testInfo) => {
  await simulateApi(page, false);
  await page.setViewportSize({ width: 640, height: 450 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const path of ['/', '/login', '/register', '/404']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('effective-200-percent.png'), fullPage: true });
});

test('simulated API: mobile financial dialogs restore focus and preserve table semantics', async ({
  page,
}) => {
  await simulateApi(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`/organizations/${org.id}/customers/${customer.id}`);
  const archive = page.getByRole('button', { name: 'Archive customer' });
  await archive.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(archive).toBeFocused();
  await page.goto(`/organizations/${org.id}/payments/${paymentFixture().id}`);
  const reverse = page.getByRole('button', { name: 'Reverse payment in full' });
  await reverse.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(reverse).toBeFocused();
});

for (const width of [320, 1440]) {
  test(`simulated API: visual evidence at ${width}px`, async ({ page }, testInfo) => {
    await simulateApi(page);
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', () => errors.push('Unhandled browser exception'));
    for (const path of [
      'dashboard',
      'customers',
      'invoices',
      'cash-flow',
      'notifications',
      'reports',
      'audit-logs',
    ]) {
      await page.goto(`/organizations/${org.id}/${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText(/^(Loading|Checking).*…$/)).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`${path}-${width}.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

test('simulated API: mobile menu focus, Escape and permission-aware tenant switching', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await simulateApi(page);
  await page.goto(`/organizations/${org.id}/workspace`);
  const trigger = page.getByRole('button', { name: 'Open navigation' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'Workspace', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.getByRole('combobox', { name: 'Organization' }).selectOption(other.id);
  await expect(page.getByRole('heading', { name: 'Beta', exact: true })).toBeVisible();
  await page.goto(`/organizations/${other.id}/payments`);
  await expect(page.getByRole('alert')).toContainText('Access denied');
  await page.goto('/organizations/ffffffff-ffff-4fff-8fff-ffffffffffff/workspace');
  await expect(page.getByRole('heading', { name: 'Organization unavailable' })).toBeVisible();
});

test('simulated API: authenticated CSV download and safe fallback filename', async ({ page }) => {
  await simulateApi(page);
  await page.goto(`/organizations/${org.id}/reports`);
  await page.getByRole('button', { name: 'CSV exports' }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: `Download CSV ${exportId}`, exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(`report-${exportId}.csv`);
  expect(await download.failure()).toBeNull();
});
