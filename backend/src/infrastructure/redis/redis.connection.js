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
    if (this.config.url) {
      const url = new URL(this.config.url);
      const database =
        url.pathname === '' || url.pathname === '/'
          ? 0
          : Number.parseInt(url.pathname.slice(1), 10);
      return {
        host: url.hostname,
        port: url.port ? Number.parseInt(url.port, 10) : 6379,
        db: database,
        ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
        ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
        ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
        ...overrides,
      };
    }
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
