import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { RequestValidationError } from './common/errors/validation-error.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { normalizeValidationErrors } from './common/http/validation/validation-errors.js';
import { RequestContextStore } from './common/request-context/request-context.store.js';

export function configureApplication(app) {
  const configService = app.get(ConfigService);
  const config = configService.getOrThrow('app');

  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: [...config.corsOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'If-Match',
      'X-Request-Id',
    ],
    exposedHeaders: ['X-Request-Id', 'ETag', 'Idempotency-Replayed'],
  });
  app.setGlobalPrefix(config.apiPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: config.apiVersion });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: false,
      stopAtFirstError: false,
      exceptionFactory: (errors) => new RequestValidationError(normalizeValidationErrors(errors)),
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter(app.get(RequestContextStore)));
  app.enableShutdownHooks();
  return config;
}
