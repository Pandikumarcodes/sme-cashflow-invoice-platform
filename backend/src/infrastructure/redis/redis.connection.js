import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisConnection {
  logger = new Logger(RedisConnection.name);
  client;

  constructor(configService) {
    this.config = configService.getOrThrow('redis');
  }

  getConnectionOptions(overrides = {}) {
    return {
      host: this.config.host,
      port: this.config.port,
      db: this.config.db,
      ...(this.config.username ? { username: this.config.username } : {}),
      ...(this.config.password ? { password: this.config.password } : {}),
      ...overrides,
    };
  }

  getClient() {
    if (!this.client || this.client.status === 'end') {
      this.client = new Redis(
        this.getConnectionOptions({
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 2_000,
          commandTimeout: 2_000,
          retryStrategy: () => null,
        }),
      );
      this.client.on('connect', () => this.logger.log('Redis connection established'));
      this.client.on('error', () => this.logger.warn('Redis connection error'));
      this.client.on('close', () => this.logger.log('Redis connection closed'));
    }
    return this.client;
  }

  async ping() {
    const client = this.getClient();
    if (client.status === 'wait') {
      await client.connect();
    }
    const response = await client.ping();
    if (response !== 'PONG') {
      throw new Error('Redis readiness check failed');
    }
  }

  async onModuleDestroy() {
    if (!this.client) return;
    if (this.client.status === 'ready') {
      await this.client.quit();
    } else if (this.client.status !== 'end' && this.client.status !== 'wait') {
      this.client.disconnect();
    }
    this.client = undefined;
  }
}
Inject(ConfigService)(RedisConnection, undefined, 0);
