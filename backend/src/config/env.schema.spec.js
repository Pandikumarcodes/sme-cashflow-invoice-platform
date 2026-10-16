import { generateKeyPairSync } from 'node:crypto';
import { parseEnvironment } from './env.schema.js';
const authKeys = {
  AUTH_ACCESS_PRIVATE_KEY_BASE64:
    'MC4CAQAwBQYDK2VwBCIEIDdyP69H0Zo0OMz9ELCqVFpF9wwAIH2Fm6GGNtW6YRX8',
  AUTH_ACCESS_PUBLIC_KEY_BASE64: 'MCowBQYDK2VwAyEABdqDMyeA8N8yOW/It/UtBCMURg8cJkEWDd0PiBwYeUw=',
};
const s3 = {
  REPORT_STORAGE_PROVIDER: 's3',
  REPORT_S3_BUCKET: 'private-report-artifacts',
  REPORT_S3_REGION: 'us-east-1',
  REPORT_S3_ACCESS_KEY_ID: 'test-id',
  REPORT_S3_SECRET_ACCESS_KEY: 'test-secret',
  REPORT_S3_OBJECT_PREFIX: 'staging/reports',
};
describe('environment configuration', () => {
  it('requires complete private object storage configuration and rejects insecure endpoints', () => {
    const base = {
      DATABASE_URL: 'postgresql://test:test@localhost:5433/sme_cashflow_test',
      ...authKeys,
    };
    for (const field of Object.keys(s3).filter((name) => name !== 'REPORT_STORAGE_PROVIDER')) {
      const invalid = { ...s3 };
      delete invalid[field];
      expect(() => parseEnvironment({ ...base, ...invalid })).toThrow(field);
    }
    expect(() =>
      parseEnvironment({ ...base, ...s3, REPORT_S3_ENDPOINT: 'http://objects.example.com' }),
    ).toThrow();
    expect(() =>
      parseEnvironment({ ...base, ...s3, REPORT_S3_OBJECT_PREFIX: '../other' }),
    ).toThrow();
    expect(parseEnvironment({ ...base, ...s3 }).REPORT_STORAGE_PROVIDER).toBe('s3');
    expect(() =>
      parseEnvironment({
        ...base,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com',
      }),
    ).toThrow('private S3 report storage');
  });
  it('bounds report expiry and requires a private storage directory setting', () => {
    for (const values of [
      { REPORT_EXPIRY_HOURS: '0' },
      { REPORT_EXPIRY_HOURS: '169' },
      { REPORT_STORAGE_DIRECTORY: ' ' },
    ]) {
      expect(() =>
        parseEnvironment({
          DATABASE_URL: 'postgresql://test:test@localhost:5433/sme_cashflow_test',
          ...authKeys,
          ...values,
        }),
      ).toThrow();
    }
  });
  it('bounds reminder policy and worker configuration', () => {
    for (const values of [
      { REMINDERS_ENABLED: 'yes' },
      { REMINDERS_DAYS_BEFORE_DUE: '31' },
      { REMINDERS_OVERDUE_CADENCE_DAYS: '0' },
      { WORKER_CONCURRENCY: '0' },
    ])
      expect(() =>
        parseEnvironment({
          DATABASE_URL: 'postgresql://test:test@localhost:5433/sme_cashflow_test',
          ...authKeys,
          ...values,
        }),
      ).toThrow();
  });
  it('accepts managed Redis URLs and rejects unsupported URL components', () => {
    const base = {
      DATABASE_URL: 'postgresql://test:test@localhost:5433/sme_cashflow_test',
      ...authKeys,
    };
    expect(
      parseEnvironment({ ...base, REDIS_URL: 'redis://cache.internal:6379/2' }).REDIS_URL,
    ).toBe('redis://cache.internal:6379/2');
    for (const REDIS_URL of [
      'https://cache.example.com',
      'rediss://cache.example.com/invalid',
      'redis://cache.example.com/0?unsafe=true',
    ])
      expect(() => parseEnvironment({ ...base, REDIS_URL })).toThrow('REDIS_URL');
  });
  it('rejects development capture as a production email provider', () => {
    expect(() =>
      parseEnvironment({
        DATABASE_URL: 'postgresql://test:test@localhost:5433/sme_cashflow_test',
        ...authKeys,
        NODE_ENV: 'production',
        ...s3,
        EMAIL_PROVIDER: 'capture',
      }),
    ).toThrow('Capture email provider');
  });
  it('applies safe local defaults', () => {
    const result = parseEnvironment({
      DATABASE_URL: 'postgresql://test:test@localhost:5433/sme_cashflow_test',
      ...authKeys,
    });
    expect(result).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      API_PREFIX: 'api',
      API_VERSION: '1',
      LOG_LEVEL: 'info',
      TRUST_PROXY: false,
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
      REDIS_DB: 0,
      QUEUE_PREFIX: 'sme',
    });
    expect(result.CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });
  it('parses a configured origin list and port', () => {
    const result = parseEnvironment({
      DATABASE_URL: 'postgresql://test:test@localhost:5433/sme_cashflow_test',
      ...authKeys,
      PORT: '4100',
      CORS_ORIGINS: 'https://app.example.com,https://admin.example.com',
      TRUST_PROXY: 'true',
    });
    expect(result.PORT).toBe(4100);
    expect(result.CORS_ORIGINS).toEqual(['https://app.example.com', 'https://admin.example.com']);
    expect(result.TRUST_PROXY).toBe(true);
  });
  const invalidEnvironments = [
    [{ DATABASE_URL: 'not-a-url' }, 'invalid database URL'],
    [{ PORT: '0' }, 'invalid port'],
    [{ API_PREFIX: '/api' }, 'invalid API prefix'],
    [{ CORS_ORIGINS: '*' }, 'wildcard CORS'],
    [{ CORS_ORIGINS: 'not-a-url' }, 'invalid CORS origin'],
    [{ TRUST_PROXY: 'yes' }, 'invalid boolean'],
    [{ REDIS_HOST: ' ' }, 'empty Redis host'],
    [{ REDIS_PORT: '0' }, 'invalid Redis port'],
    [{ REDIS_DB: '-1' }, 'invalid Redis database'],
    [{ QUEUE_PREFIX: 'Unsafe Prefix' }, 'invalid queue prefix'],
  ];
  it.each(invalidEnvironments)('rejects %s (%s)', (environment) => {
    expect(() => parseEnvironment({ ...authKeys, ...environment })).toThrow();
  });
});

it('rejects published production keys and insecure or implicit production origins', () => {
  const base = {
    DATABASE_URL: 'postgresql://test:test@localhost:5433/sme_cashflow_test',
    ...authKeys,
    NODE_ENV: 'production',
    ...s3,
    REDIS_URL: 'redis://cache.internal:6379',
  };
  expect(() => parseEnvironment({ ...base, CORS_ORIGINS: 'https://app.example.com' })).toThrow(
    'signing key pair',
  );
  expect(() => parseEnvironment(base)).toThrow('HTTPS');
  expect(() => parseEnvironment({ ...base, CORS_ORIGINS: 'http://app.example.com' })).toThrow(
    'HTTPS',
  );
  const keys = generateKeyPairSync('ed25519');
  const production = {
    ...base,
    CORS_ORIGINS: 'https://app.example.com',
    AUTH_ACCESS_PRIVATE_KEY_BASE64: keys.privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64'),
    AUTH_ACCESS_PUBLIC_KEY_BASE64: keys.publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64'),
  };
  const productionWithoutRedis = { ...production };
  delete productionWithoutRedis.REDIS_URL;
  expect(() => parseEnvironment(productionWithoutRedis)).toThrow('REDIS_URL');
  expect(
    parseEnvironment({
      ...production,
    }).NODE_ENV,
  ).toBe('production');
});
it('never echoes invalid configuration values', () => {
  try {
    parseEnvironment({ ...authKeys, DATABASE_URL: 'SECRET_INVALID_URL' });
  } catch (error) {
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).not.toContain('SECRET');
    return;
  }
  throw new Error('Expected rejection');
});
