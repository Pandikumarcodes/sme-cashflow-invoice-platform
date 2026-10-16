import { z } from 'zod';
const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
const corsOrigins = z
  .string()
  .min(1, 'CORS_ORIGINS must contain at least one origin')
  .transform((value) => value.split(',').map((origin) => origin.trim()))
  .refine((origins) => origins.every((origin) => origin.length > 0), {
    message: 'CORS_ORIGINS contains an empty origin',
  })
  .refine((origins) => origins.every((origin) => origin !== '*'), {
    message: 'CORS_ORIGINS must not contain a wildcard',
  })
  .refine(
    (origins) =>
      origins.every((origin) => {
        try {
          const url = new URL(origin);
          return ['http:', 'https:'].includes(url.protocol) && url.origin === origin;
        } catch {
          return false;
        }
      }),
    { message: 'CORS_ORIGINS must contain comma-separated URL origins' },
  );
const redisUrl = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, context) => {
    try {
      const parsed = new URL(value);
      if (!['redis:', 'rediss:'].includes(parsed.protocol))
        context.addIssue({ code: 'custom', message: 'REDIS_URL must use redis:// or rediss://' });
      if (parsed.search || parsed.hash)
        context.addIssue({
          code: 'custom',
          message: 'REDIS_URL must not contain query or fragment values',
        });
      if (parsed.pathname && parsed.pathname !== '/' && !/^\/\d+$/.test(parsed.pathname))
        context.addIssue({
          code: 'custom',
          message: 'REDIS_URL database path must be a non-negative integer',
        });
    } catch {
      context.addIssue({ code: 'custom', message: 'REDIS_URL must be a valid Redis URL' });
    }
  });
export const environmentSchema = z.object({
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  API_PREFIX: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, 'API_PREFIX must be a single lowercase path segment')
    .default('api'),
  API_VERSION: z.string().regex(/^\d+$/, 'API_VERSION must be numeric').default('1'),
  CORS_ORIGINS: corsOrigins.default(['http://localhost:5173']),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: booleanString.default(false),
  REDIS_URL: redisUrl.optional(),
  REDIS_HOST: z.string().trim().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().min(1).max(65_535).default(6379),
  REDIS_USERNAME: z.string().trim().min(1).optional(),
  REDIS_PASSWORD: z.string().min(1).optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  QUEUE_PREFIX: z
    .string()
    .regex(/^[a-z0-9][a-z0-9:_-]*$/, 'QUEUE_PREFIX must be a safe lowercase namespace')
    .default('sme'),
  REMINDERS_ENABLED: booleanString.default(true),
  REMINDERS_DAYS_BEFORE_DUE: z.coerce.number().int().min(0).max(30).default(3),
  REMINDERS_OVERDUE_CADENCE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  EMAIL_PROVIDER: z.enum(['disabled', 'capture']).default('disabled'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  REPORT_STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  REPORT_STORAGE_DIRECTORY: z.string().trim().min(1).default('.private/reports'),
  REPORT_S3_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
    .optional(),
  REPORT_S3_REGION: z.string().trim().min(1).optional(),
  REPORT_S3_ENDPOINT: z.string().url().startsWith('https://').optional(),
  REPORT_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  REPORT_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  REPORT_S3_OBJECT_PREFIX: z
    .string()
    .regex(/^[a-z0-9][a-z0-9/_-]*[a-z0-9]$/)
    .optional(),
  REPORT_EXPIRY_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  AUTH_ACCESS_PRIVATE_KEY_BASE64: z.string().min(40),
  AUTH_ACCESS_PUBLIC_KEY_BASE64: z.string().min(40),
  AUTH_ACCESS_TOKEN_LIFETIME_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  AUTH_REFRESH_TOKEN_LIFETIME_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  AUTH_JWT_ISSUER: z.string().trim().min(1).default('sme-cashflow-api'),
  AUTH_JWT_AUDIENCE: z.string().trim().min(1).default('sme-cashflow-client'),
  AUTH_JWT_KEY_ID: z.string().trim().min(1).default('local-development-1'),
  AUTH_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .default('sme_refresh'),
  AUTH_RATE_LIMIT_PREFIX: z
    .string()
    .regex(/^[a-z0-9:_-]+$/)
    .default('sme:auth-rate'),
  AUTH_REGISTER_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(5),
  AUTH_LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(5),
  AUTH_LOGIN_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(20),
  AUTH_REFRESH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(30),
});
export function parseEnvironment(environment) {
  const result = environmentSchema.safeParse(environment);
  if (!result.success)
    throw new Error(
      `Invalid environment fields: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  const parsed = result.data;
  if (parsed.NODE_ENV === 'production' && parsed.REPORT_STORAGE_PROVIDER !== 's3')
    throw new Error('Production requires private S3 report storage.');
  if (parsed.REPORT_STORAGE_PROVIDER === 's3') {
    const required = [
      'REPORT_S3_BUCKET',
      'REPORT_S3_REGION',
      'REPORT_S3_ACCESS_KEY_ID',
      'REPORT_S3_SECRET_ACCESS_KEY',
      'REPORT_S3_OBJECT_PREFIX',
    ];
    const missing = required.filter((name) => !parsed[name]);
    if (missing.length) throw new Error(`Missing report storage fields: ${missing.join(', ')}`);
  }
  if (parsed.NODE_ENV === 'production' && parsed.EMAIL_PROVIDER === 'capture')
    throw new Error('Capture email provider is limited to development and tests.');
  if (parsed.NODE_ENV === 'production') {
    if (!parsed.REDIS_URL) throw new Error('Production requires REDIS_URL.');
    if (
      !environment.CORS_ORIGINS ||
      parsed.CORS_ORIGINS.some((origin) => !origin.startsWith('https://'))
    )
      throw new Error('Production requires explicit HTTPS CORS origins.');
    if (
      Buffer.from(parsed.AUTH_ACCESS_PUBLIC_KEY_BASE64, 'base64').toString('base64') ===
      'MCowBQYDK2VwAyEABdqDMyeA8N8yOW/It/UtBCMURg8cJkEWDd0PiBwYeUw='
    )
      throw new Error('Production requires a private deployment signing key pair.');
  }
  return parsed;
}
export function validateEnvironment(environment) {
  return { ...environment, ...parseEnvironment(environment) };
}
