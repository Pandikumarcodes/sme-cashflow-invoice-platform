import { spawnSync } from 'node:child_process';
import { assertSafeTestDatabase } from '../test/integration/database-test-helpers.js';

if (!process.env.DATABASE_URL_TEST) throw new Error('DATABASE_URL_TEST must be configured.');
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
assertSafeTestDatabase();
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--status'))
  throw new Error('Only --status is supported.');
const result = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', args[0] === '--status' ? 'status' : 'deploy'],
  { env: process.env, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
