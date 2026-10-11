import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { RedisHealthIndicator } from '../../infrastructure/redis/redis-health.indicator.js';
@Controller('health')
export class HealthController {
  constructor(prisma, redis) {
    this.prisma = prisma;
    this.redis = redis;
  }
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    try {
      await Promise.all([this.prisma.isHealthy(), this.redis.isHealthy()]);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
Inject(PrismaService)(HealthController, undefined, 0);
Inject(RedisHealthIndicator)(HealthController, undefined, 1);
