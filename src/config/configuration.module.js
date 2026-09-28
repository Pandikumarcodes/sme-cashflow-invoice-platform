import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './app.config.js';
import authConfig from './auth.config.js';
import { validateEnvironment } from './env.schema.js';
import loggingConfig from './logging.config.js';
import queueConfig from './queue.config.js';
import redisConfig from './redis.config.js';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: false,
      load: [appConfig, authConfig, loggingConfig, redisConfig, queueConfig],
      validate: validateEnvironment,
    }),
  ],
})
export class ConfigurationModule {}
