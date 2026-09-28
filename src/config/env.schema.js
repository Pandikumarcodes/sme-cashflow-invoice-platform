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
          return url.origin === origin;
        } catch {
          return false;
        }
      }),
    { message: 'CORS_ORIGINS must contain comma-separated URL origins' },
  );
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
  REDIS_HOST: z.string().trim().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().min(1).max(65_535).default(6379),
  REDIS_USERNAME: z.string().trim().min(1).optional(),
  REDIS_PASSWORD: z.string().min(1).optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  QUEUE_PREFIX: z
    .string()
    .regex(/^[a-z0-9][a-z0-9:_-]*$/, 'QUEUE_PREFIX must be a safe lowercase namespace')
    .default('sme'),
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
  return environmentSchema.parse(environment);
}
export function validateEnvironment(environment) {
  return { ...environment, ...parseEnvironment(environment) };
}
