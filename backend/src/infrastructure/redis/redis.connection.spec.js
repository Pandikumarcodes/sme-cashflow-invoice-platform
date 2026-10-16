import { jest } from '@jest/globals';

import { RedisConnection } from './redis.connection.js';

describe('RedisConnection', () => {
  const config = {
    host: 'localhost',
    port: 6379,
    username: undefined,
    password: undefined,
    db: 2,
  };

  it('provides validated connection options and applies consumer overrides', () => {
    const service = new RedisConnection({ getOrThrow: () => config });
    expect(service.getConnectionOptions({ maxRetriesPerRequest: null })).toEqual({
      host: 'localhost',
      port: 6379,
      db: 2,
      maxRetriesPerRequest: null,
    });
  });

  it('parses a managed Redis URL without retaining the connection string', () => {
    const service = new RedisConnection({
      getOrThrow: () => ({
        ...config,
        url: 'rediss://default:secret%2Fvalue@cache.example.com:6380/4',
      }),
    });

    expect(service.getConnectionOptions({ maxRetriesPerRequest: null })).toEqual({
      host: 'cache.example.com',
      port: 6380,
      db: 4,
      username: 'default',
      password: 'secret/value',
      tls: {},
      maxRetriesPerRequest: null,
    });
  });

  it('closes a ready connection gracefully', async () => {
    const service = new RedisConnection({ getOrThrow: () => config });
    const quit = jest.fn().mockResolvedValue('OK');
    service.client = { status: 'ready', quit };
    await service.onModuleDestroy();
    expect(quit).toHaveBeenCalledTimes(1);
    expect(service.client).toBeUndefined();
  });

  it('disconnects a connection that is not ready', async () => {
    const service = new RedisConnection({ getOrThrow: () => config });
    const disconnect = jest.fn();
    service.client = { status: 'connecting', disconnect };
    await service.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
