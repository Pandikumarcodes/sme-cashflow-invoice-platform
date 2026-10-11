import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';

function context(body = {}) {
  return {
    getHandler: () => 'handler',
    switchToHttp: () => ({
      getRequest: () => ({ body, ip: '127.0.0.1' }),
    }),
  };
}

describe('AuthRateLimitGuard', () => {
  it('rejects attempts after the configured Redis-backed limit', async () => {
    let count = 0;
    const guard = new AuthRateLimitGuard(
      { get: () => 'register' },
      { getClient: () => ({ status: 'ready', eval: async () => ++count }) },
      {
        getOrThrow: () => ({
          rateLimitPrefix: 'test',
          registerRateLimitPerHour: 1,
        }),
      },
    );
    await expect(guard.canActivate(context())).resolves.toBe(true);
    await expect(guard.canActivate(context())).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
