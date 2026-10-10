import { spawnSync } from 'node:child_process';

function assertSafeTestDatabase(urlValue) {
  if (!urlValue) {
    throw new Error('DATABASE_URL_TEST must be configured for integration tests.');
  }

  const url = new URL(urlValue);
  const databaseName = url.pathname.slice(1);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

  if (!isLocal || databaseName !== 'sme_cashflow_test') {
    throw new Error('Integration tests require the local sme_cashflow_test database.');
  }

  return urlValue;
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = assertSafeTestDatabase(process.env.DATABASE_URL_TEST);

const result = spawnSync(
  process.execPath,
  [
    '--experimental-vm-modules',
    'node_modules/jest/bin/jest.js',
    '--config',
    'jest.integration.config.cjs',
    '--runInBand',
    ...process.argv.slice(2),
  ],
  { env: process.env, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
