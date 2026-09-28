import { Injectable, Inject } from '@nestjs/common';

import { RedisConnection } from './redis.connection.js';

@Injectable()
export class RedisHealthIndicator {
  constructor(redis) {
    this.redis = redis;
  }

  async isHealthy() {
    await this.redis.ping();
  }
}
Inject(RedisConnection)(RedisHealthIndicator, undefined, 0);
