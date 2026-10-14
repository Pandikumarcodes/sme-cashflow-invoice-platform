import { test as base, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { withApiContexts } from '../../src/test/api-context-lifecycle';

export const test = base.extend<{
  createApi: () => Promise<APIRequestContext>;
}>({
  createApi: async ({ playwright }, use) => {
    await withApiContexts(
      () =>
        playwright.request.newContext({
          baseURL: 'http://localhost:3001/api/v1/',
        }),
      use,
    );
  },
});

export { expect };
