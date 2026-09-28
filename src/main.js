import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  const config = configureApplication(app);
  await app.listen(config.port);
}

void bootstrap().catch(() => {
  Logger.error('Application failed to start. Review the protected startup logs.');
  process.exitCode = 1;
});
