import { createHash } from 'node:crypto';
import { Inject, Injectable, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { RedisConnection } from '../../../infrastructure/redis/redis.connection.js';
import { normalizeEmail } from '../domain/email.js';

const RATE_LIMIT_KIND = 'authRateLimitKind';
const INCREMENT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return current
`;

export const AuthRateLimit = (kind) => SetMetadata(RATE_LIMIT_KIND, kind);

@Injectable()
export class AuthRateLimitGuard {
  constructor(reflector, redisConnection, configService) {
    this.reflector = reflector;
    this.redisConnection = redisConnection;
    this.config = configService.getOrThrow('auth');
  }

  async canActivate(context) {
    const kind = this.reflector.get(RATE_LIMIT_KIND, context.getHandler());
    if (!kind) return true;
    const request = context.switchToHttp().getRequest();
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    const identity =
      typeof request.body?.email === 'string' ? normalizeEmail(request.body.email) : 'anonymous';
    const buckets = this.buckets(kind, ip, identity);
    const client = this.redisConnection.getClient();
    if (client.status === 'wait') await client.connect();
    for (const bucket of buckets) {
      const count = await client.eval(INCREMENT_SCRIPT, 1, bucket.key, bucket.windowSeconds);
      if (Number(count) > bucket.limit) {
        throw new ApplicationError(
          ERROR_CODES.RATE_LIMITED,
          'Too many authentication attempts. Try again later.',
        );
      }
    }
    return true;
  }

  buckets(kind, ip, identity) {
    const digest = (value) => createHash('sha256').update(value).digest('hex');
    const base = this.config.rateLimitPrefix;
    if (kind === 'login') {
      return [
        {
          key: `${base}:login:minute:${digest(`${ip}:${identity}`)}`,
          limit: this.config.loginRateLimitPerMinute,
          windowSeconds: 60,
        },
        {
          key: `${base}:login:hour:${digest(identity)}`,
          limit: this.config.loginRateLimitPerHour,
          windowSeconds: 3600,
        },
      ];
    }
    if (kind === 'register') {
      return [
        {
          key: `${base}:register:hour:${digest(ip)}`,
          limit: this.config.registerRateLimitPerHour,
          windowSeconds: 3600,
        },
      ];
    }
    return [
      {
        key: `${base}:refresh:minute:${digest(ip)}`,
        limit: this.config.refreshRateLimitPerMinute,
        windowSeconds: 60,
      },
    ];
  }
}
Inject(Reflector)(AuthRateLimitGuard, undefined, 0);
Inject(RedisConnection)(AuthRateLimitGuard, undefined, 1);
Inject(ConfigService)(AuthRateLimitGuard, undefined, 2);
