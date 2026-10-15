// Run from backend/ after its build. No seeds, deletes, migrations or auth overrides.
import { createRequire } from 'node:module';
import { generateKeyPairSync, randomUUID } from 'node:crypto';

process.loadEnvFile('.env');
if (process.env.NODE_ENV === 'production')
  throw new Error('Production configuration is forbidden.');
if (!process.env.DATABASE_URL_TEST) throw new Error('DATABASE_URL_TEST is required.');
let target;
try {
  target = new URL(process.env.DATABASE_URL_TEST);
} catch {
  throw new Error('DATABASE_URL_TEST must be a valid local test database URL.');
}
if (
  target.protocol !== 'postgresql:' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  target.pathname !== '/sme_cashflow_test'
)
  throw new Error('Only the local sme_cashflow_test database is allowed.');

const run = randomUUID();
const keys = generateKeyPairSync('ed25519');
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL_TEST,
  PORT: '3001',
  CORS_ORIGINS: 'http://localhost:5174',
  LOG_LEVEL: 'silent',
  QUEUE_PREFIX: `frontend-readiness-${run}`,
  AUTH_RATE_LIMIT_PREFIX: `frontend:readiness:${run}`,
  AUTH_COOKIE_NAME: 'sme_readiness_refresh',
  AUTH_ACCESS_PRIVATE_KEY_BASE64: keys.privateKey
    .export({ type: 'pkcs8', format: 'der' })
    .toString('base64'),
  AUTH_ACCESS_PUBLIC_KEY_BASE64: keys.publicKey
    .export({ type: 'spki', format: 'der' })
    .toString('base64'),
  AUTH_ACCESS_TOKEN_LIFETIME_SECONDS: '900',
  REPORT_STORAGE_DIRECTORY: `.private/frontend-readiness/${run}`,
  EMAIL_PROVIDER: 'disabled',
});
const requireBackend = createRequire(new URL('../../backend/package.json', import.meta.url));
requireBackend('reflect-metadata');
const { NestFactory } = requireBackend('@nestjs/core');
const { AppModule } = await import('../../backend/dist/app.module.js');
const { WorkerModule } = await import('../../backend/dist/worker.module.js');
const { configureApplication } = await import('../../backend/dist/bootstrap.js');
const { GlobalExceptionFilter } =
  await import('../../backend/dist/common/filters/global-exception.filter.js');
const mapException = GlobalExceptionFilter.prototype.mapException;
// Preserve the exact API error mapping. Emit only static diagnostic categories;
// never exception text, stacks, SQL, ORM metadata, credentials or request bodies.
GlobalExceptionFilter.prototype.mapException = function (exception, requestId) {
  const mapped = mapException.call(this, exception, requestId);
  if (mapped.status >= 500) {
    const category =
      {
        P2028: 'TRANSACTION_DEADLINE',
        P2024: 'POOL_DEADLINE',
        P1001: 'DATABASE_UNAVAILABLE',
        P2010: 'QUERY_FAILURE',
        P2034: 'CONCURRENT_TRANSACTION',
        P2037: 'CONNECTION_LIMIT',
      }[exception?.code] ?? 'UNEXPECTED_FAILURE';
    console.warn(
      JSON.stringify({
        event: 'guarded_live_http_failure',
        category,
        requestId,
        status: mapped.status,
        timestamp: new Date().toISOString(),
      }),
    );
  }
  return mapped;
};
const api = await NestFactory.create(AppModule, { logger: false });
configureApplication(api);
const worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
await api.listen(3001, 'localhost');
console.info('Guarded frontend integration API and worker ready on localhost:3001.');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await worker.close();
  await api.close();
}
process.on('SIGTERM', () => {
  void close();
});
process.on('SIGINT', () => {
  void close();
});
