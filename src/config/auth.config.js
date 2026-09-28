import { registerAs } from '@nestjs/config';
import { parseEnvironment } from './env.schema.js';

export default registerAs('auth', () => {
  const environment = parseEnvironment(process.env);
  return {
    accessPrivateKeyBase64: environment.AUTH_ACCESS_PRIVATE_KEY_BASE64,
    accessPublicKeyBase64: environment.AUTH_ACCESS_PUBLIC_KEY_BASE64,
    accessLifetimeSeconds: environment.AUTH_ACCESS_TOKEN_LIFETIME_SECONDS,
    refreshLifetimeDays: environment.AUTH_REFRESH_TOKEN_LIFETIME_DAYS,
    issuer: environment.AUTH_JWT_ISSUER,
    audience: environment.AUTH_JWT_AUDIENCE,
    keyId: environment.AUTH_JWT_KEY_ID,
    cookieName: environment.AUTH_COOKIE_NAME,
    cookieSecure: environment.NODE_ENV === 'production',
    rateLimitPrefix: environment.AUTH_RATE_LIMIT_PREFIX,
    registerRateLimitPerHour: environment.AUTH_REGISTER_RATE_LIMIT_PER_HOUR,
    loginRateLimitPerMinute: environment.AUTH_LOGIN_RATE_LIMIT_PER_MINUTE,
    loginRateLimitPerHour: environment.AUTH_LOGIN_RATE_LIMIT_PER_HOUR,
    refreshRateLimitPerMinute: environment.AUTH_REFRESH_RATE_LIMIT_PER_MINUTE,
    corsOrigins: environment.CORS_ORIGINS,
    cookiePath: `/${environment.API_PREFIX}/v${environment.API_VERSION}/auth`,
  };
});
