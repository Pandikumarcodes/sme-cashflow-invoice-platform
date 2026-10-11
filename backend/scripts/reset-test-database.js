import { spawnSync } from 'node:child_process';

const urlValue = process.env.DATABASE_URL_TEST;
if (!urlValue) {
  throw new Error('DATABASE_URL_TEST must be configured.');
}

const url = new URL(urlValue);
if (
  !['localhost', '127.0.0.1', '::1'].includes(url.hostname) ||
  url.pathname !== '/sme_cashflow_test'
) {
  throw new Error('Refusing to reset a database other than local sme_cashflow_test.');
}

const result = spawnSync('npx.cmd', ['prisma', 'migrate', 'reset', '--force', '--skip-seed'], {
  env: { ...process.env, DATABASE_URL: urlValue },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
