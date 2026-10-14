import { createConnection } from 'node:net';
import { assertSafeTestDatabase } from '../test/integration/database-test-helpers.js';

if (!process.env.DATABASE_URL_TEST) throw new Error('DATABASE_URL_TEST is required.');
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
let database;
try {
  database = new URL(process.env.DATABASE_URL);
  if (database.protocol !== 'postgresql:') throw new Error();
  assertSafeTestDatabase();
} catch {
  throw new Error('Diagnostics require local PostgreSQL sme_cashflow_test.');
}
const targets = [
  ['postgres', database.hostname, Number(database.port || 5432)],
  ['redis', process.env.REDIS_HOST ?? 'localhost', Number(process.env.REDIS_PORT ?? 6379)],
];
let failed = false;
for (const [dependency, host, port] of targets) {
  const result = await new Promise((resolve) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(3000);
    socket.once('connect', () => {
      socket.destroy();
      resolve('TCP_OPEN');
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve('TCP_TIMEOUT');
    });
    socket.once('error', (error) =>
      resolve(error.code === 'ECONNREFUSED' ? 'TCP_REFUSED' : 'TCP_ERROR'),
    );
  });
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), dependency, result }));
  failed ||= result !== 'TCP_OPEN';
}
// Open sockets alone do not establish SQL/Redis readiness or correct migrations.
process.exitCode = failed ? 1 : 0;
