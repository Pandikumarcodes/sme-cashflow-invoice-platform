import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { resolveRequestId } from '../common/request-context/request-id.js';
import { LOG_REDACT_PATHS } from './redaction.js';
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService) => {
        const logging = configService.getOrThrow('logging');
        return {
          pinoHttp: {
            level: logging.level,
            redact: { paths: [...LOG_REDACT_PATHS], censor: '[REDACTED]' },
            genReqId: (request, response) => {
              const resolved = resolveRequestId(request.headers['x-request-id']);
              response.setHeader('X-Request-Id', resolved.requestId);
              return resolved.requestId;
            },
            customAttributeKeys: { req: 'request', res: 'response', responseTime: 'durationMs' },
          },
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class ObservabilityModule {}
