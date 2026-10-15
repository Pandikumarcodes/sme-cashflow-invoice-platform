import { generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { assertSafeTestDatabase } from '../test/integration/database-test-helpers.js';

if (process.env.CI !== 'true' || process.env.NODE_ENV === 'production') {
  throw new Error('Only an isolated CI test environment is supported.');
}
if (!process.env.DATABASE_URL_TEST) throw new Error('DATABASE_URL_TEST is required.');
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
try {
  if (new URL(process.env.DATABASE_URL).protocol !== 'postgresql:') throw new Error();
  assertSafeTestDatabase();
} catch {
  throw new Error('CI configuration requires local PostgreSQL sme_cashflow_test.');
}
const keys = generateKeyPairSync('ed25519');
const values = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL_TEST,
  DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
  AUTH_ACCESS_PRIVATE_KEY_BASE64: keys.privateKey
    .export({ type: 'pkcs8', format: 'der' })
    .toString('base64'),
  AUTH_ACCESS_PUBLIC_KEY_BASE64: keys.publicKey
    .export({ type: 'spki', format: 'der' })
    .toString('base64'),
  LOG_LEVEL: 'silent',
  EMAIL_PROVIDER: 'disabled',
};
// Refuse to replace any existing local environment; never print its contents.
await writeFile(
  '.env',
  Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n') + '\n',
  { flag: 'wx', mode: 0o600 },
);
console.info('Created isolated test configuration with ephemeral signing keys.');
