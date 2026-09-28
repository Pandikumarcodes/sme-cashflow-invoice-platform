import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://test:test@localhost:5433/sme_cashflow_test';
process.env.PORT = '3001';
process.env.API_PREFIX = 'api';
process.env.API_VERSION = '1';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.LOG_LEVEL = 'silent';
process.env.TRUST_PROXY = 'false';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.REDIS_DB = '0';
process.env.QUEUE_PREFIX = 'sme-test';
process.env.AUTH_ACCESS_PRIVATE_KEY_BASE64 =
  'MC4CAQAwBQYDK2VwBCIEIDdyP69H0Zo0OMz9ELCqVFpF9wwAIH2Fm6GGNtW6YRX8';
process.env.AUTH_ACCESS_PUBLIC_KEY_BASE64 =
  'MCowBQYDK2VwAyEABdqDMyeA8N8yOW/It/UtBCMURg8cJkEWDd0PiBwYeUw=';
process.env.AUTH_ACCESS_TOKEN_LIFETIME_SECONDS = '900';
process.env.AUTH_REFRESH_TOKEN_LIFETIME_DAYS = '30';
process.env.AUTH_JWT_ISSUER = 'sme-cashflow-api-test';
process.env.AUTH_JWT_AUDIENCE = 'sme-cashflow-client-test';
process.env.AUTH_JWT_KEY_ID = 'test-1';
process.env.AUTH_COOKIE_NAME = 'sme_refresh';
// Rate-limit buckets intentionally outlive an application instance. Isolate each Jest
// environment so an earlier test run cannot throttle the next one.
process.env.AUTH_RATE_LIMIT_PREFIX = `sme:test:auth-rate:${randomUUID()}`;
process.env.AUTH_REGISTER_RATE_LIMIT_PER_HOUR = '100';
process.env.AUTH_LOGIN_RATE_LIMIT_PER_MINUTE = '100';
process.env.AUTH_LOGIN_RATE_LIMIT_PER_HOUR = '100';
process.env.AUTH_REFRESH_RATE_LIMIT_PER_MINUTE = '100';
