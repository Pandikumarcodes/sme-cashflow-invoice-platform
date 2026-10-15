import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { simulateApi, org } from './fixtures';
import { auditFixture } from '../src/features/reports/test-fixtures';

for (const width of [320, 375, 390, 768, 1024, 1280, 1440]) {
  test(`activity redesign: reflow, disclosures and actions at ${width}px`, async ({
    page,
  }, info) => {
    await simulateApi(page);
    await page.route('**/api/v1/organizations/*/audit-logs?**', (route) =>
      route.fulfill({
        json: {
          data: [auditFixture({ action: 'INVOICE_ISSUED' })],
          meta: { limit: 25, hasMore: false, nextCursor: null },
        },
      }),
    );
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['audit-logs', 'notifications']) {
      await page.goto(`/organizations/${org.id}/${route}`);
      const list = page.getByRole('list', {
        name: route === 'audit-logs' ? 'Audit history' : 'Notification inbox',
      });
      await expect(list).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${route}-${width}.png`), fullPage: true });
      if (route === 'audit-logs') {
        const exact = page.getByText('Exact-match filters', { exact: true });
        await expect(exact).toHaveCSS('display', 'list-item');
        await expect(page.getByLabel('Exact action')).toBeHidden();
        await exact.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByLabel('Exact action')).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(page.getByLabel('Exact action')).toBeHidden();
        const details = list.getByText('View safe event details').first();
        await details.focus();
        await page.keyboard.press('Enter');
        await expect(list.getByText('Original action code').first()).toBeVisible();
      } else {
        await expect(list.getByText('Unread', { exact: true }).first()).toBeVisible();
        const archive = list.getByRole('button', { name: /^Archive / }).first();
        await archive.click();
        await expect(list.getByRole('button', { name: /^Confirm archive/ }).first()).toBeFocused();
        await list.getByRole('button', { name: 'Keep in inbox' }).first().click();
        await expect(archive).toBeFocused();
        await archive.click();
      }
      await page.screenshot({
        path: info.outputPath(`${route}-expanded-${width}.png`),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
    }
  });
}

test('activity redesign: compact empty states', async ({ page }, info) => {
  await simulateApi(page);
  await page.route('**/api/v1/organizations/*/notifications?**', (route) =>
    route.fulfill({ json: { data: [], meta: { limit: 25, hasMore: false, nextCursor: null } } }),
  );
  await page.route('**/api/v1/organizations/*/audit-logs?**', (route) =>
    route.fulfill({ json: { data: [], meta: { limit: 25, hasMore: false, nextCursor: null } } }),
  );
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['notifications', 'audit-logs']) {
      await page.goto(`/organizations/${org.id}/${route}`);
      await expect(
        page.getByText(
          route === 'notifications' ? /all caught up/ : 'No audit entries match these filters.',
        ),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`${route}-empty-${width}.png`),
        fullPage: true,
      });
    }
  }
});
