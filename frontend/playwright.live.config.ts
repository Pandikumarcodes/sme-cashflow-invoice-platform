import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/live',
  outputDir: './test-results/live',
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    [
      'html',
      {
        open: 'never',
        outputFolder: process.env.REMEDIATION_REPORT_DIRECTORY ?? 'playwright-report/live',
      },
    ],
  ],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'edge-live',
      use: process.env.CI
        ? { ...devices['Desktop Chrome'] }
        : { ...devices['Desktop Edge'], channel: 'msedge' },
    },
  ],
  webServer: [
    {
      command: 'node ../frontend/e2e/live-server.mjs',
      cwd: '../backend',
      url: 'http://localhost:3001/api/v1/health/ready',
      reuseExistingServer: false,
      // This Windows host has exceeded the 60s service-start deadline. Tests and
      // assertions keep their budgets; the isolated API must still become ready.
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      command: 'npm run dev -- --port 5174',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      env: { VITE_API_BASE_URL: 'http://localhost:3001/api/v1' },
    },
  ],
});
