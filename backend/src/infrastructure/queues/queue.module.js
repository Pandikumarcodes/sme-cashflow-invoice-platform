import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisConnection } from '../redis/redis.connection.js';
import { RedisModule } from '../redis/redis.module.js';
import { QueueFactory } from './queue.factory.js';
import {
  BULLMQ_CONNECTION_OPTIONS,
  BULLMQ_ROOT_OPTIONS,
  DEFAULT_JOB_OPTIONS,
} from './queue-options.js';

const connectionOptionsProvider = {
  provide: BULLMQ_CONNECTION_OPTIONS,
  inject: [RedisConnection],
  useFactory: (redis) => redis.getConnectionOptions({ maxRetriesPerRequest: null }),
};

const rootOptionsProvider = {
  provide: BULLMQ_ROOT_OPTIONS,
  inject: [ConfigService, BULLMQ_CONNECTION_OPTIONS],
  useFactory: (configService, connection) => ({
    connection,
    prefix: configService.getOrThrow('queue').prefix,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  }),
};

@Global()
@Module({
  imports: [RedisModule],
  providers: [connectionOptionsProvider, rootOptionsProvider, QueueFactory],
  exports: [BULLMQ_CONNECTION_OPTIONS, BULLMQ_ROOT_OPTIONS, QueueFactory],
})
export class QueueModule {}
