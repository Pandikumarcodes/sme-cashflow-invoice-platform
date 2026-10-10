import { parseEnvironment } from './env.schema.js';
const authKeys = {
  AUTH_ACCESS_PRIVATE_KEY_BASE64:
    'MC4CAQAwBQYDK2VwBCIEIDdyP69H0Zo0OMz9ELCqVFpF9wwAIH2Fm6GGNtW6YRX8',
  AUTH_ACCESS_PUBLIC_KEY_BASE64: 'MCowBQYDK2VwAyEABdqDMyeA8N8yOW/It/UtBCMURg8cJkEWDd0PiBwYeUw=',
};
describe('environment configuration', () => {
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
  it('rejects development capture as a production email provider', () => {
    expect(() =>
      parseEnvironment({
        DATABASE_URL: 'postgresql://test:test@localhost:5433/sme_cashflow_test',
        ...authKeys,
        NODE_ENV: 'production',
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
