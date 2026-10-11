import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { resolveRequestId } from './request-id.js';
import { RequestContextStore } from './request-context.store.js';
@Injectable()
export class RequestContextMiddleware {
  constructor(requestContext) {
    this.requestContext = requestContext;
  }
  use(request, response, next) {
    const inbound = resolveRequestId(request.headers['x-request-id']);
    const loggerRequestId =
      typeof request.id === 'string'
        ? request.id
        : typeof request.id === 'number'
          ? String(request.id)
          : undefined;
    const requestId =
      inbound.source === 'external' ? inbound.requestId : (loggerRequestId ?? inbound.requestId);
    response.setHeader('X-Request-Id', requestId);
    this.requestContext.run(
      { requestId, correlationId: randomUUID(), requestIdSource: inbound.source },
      next,
    );
  }
}
Inject(RequestContextStore)(RequestContextMiddleware, undefined, 0);
