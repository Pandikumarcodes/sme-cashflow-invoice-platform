import { spawnSync } from 'node:child_process';
import { assertSafeTestDatabase } from '../test/integration/database-test-helpers.js';

if (!process.env.DATABASE_URL_TEST) throw new Error('DATABASE_URL_TEST must be configured.');
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
assertSafeTestDatabase();
const result = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  { env: process.env, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
