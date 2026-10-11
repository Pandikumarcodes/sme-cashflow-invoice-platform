import { Global, Module } from '@nestjs/common';

import { RedisConnection } from './redis.connection.js';
import { RedisHealthIndicator } from './redis-health.indicator.js';

@Global()
@Module({
  providers: [RedisConnection, RedisHealthIndicator],
  exports: [RedisConnection, RedisHealthIndicator],
})
export class RedisModule {}
