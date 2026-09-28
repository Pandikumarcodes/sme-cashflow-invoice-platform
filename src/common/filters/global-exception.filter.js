import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ApplicationError } from '../errors/application-error.js';
import { ERROR_CODES } from '../errors/error-codes.js';
import { httpStatusForError } from '../errors/error-http-map.js';
import { RequestValidationError } from '../errors/validation-error.js';

const NOT_FOUND_STATUS = HttpStatus.NOT_FOUND;
const INTERNAL_SERVER_ERROR_STATUS = HttpStatus.INTERNAL_SERVER_ERROR;
@Catch()
export class GlobalExceptionFilter {
  logger = new Logger(GlobalExceptionFilter.name);
  constructor(requestContext) {
    this.requestContext = requestContext;
  }
  catch(exception, host) {
    const http = host.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();
    const requestId = this.requestContext.get()?.requestId ?? 'unavailable';
    const mapped = this.mapException(exception, requestId);
    if (mapped.status >= INTERNAL_SERVER_ERROR_STATUS)
      this.logger.error({
        event: 'unhandled_request_error',
        requestId,
        method: request.method,
        path: request.path,
        error:
          exception instanceof Error
            ? { name: exception.name, message: exception.message, stack: exception.stack }
            : { type: typeof exception },
      });
    response.status(mapped.status).json(mapped.body);
  }
  mapException(exception, requestId) {
    if (exception instanceof RequestValidationError)
      return {
        status: httpStatusForError(exception.code),
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            fields: exception.fields,
            requestId,
          },
        },
      };
    if (exception instanceof ApplicationError) {
      const error = {
        code: exception.code,
        message: exception.message,
        requestId,
        ...(exception.details === undefined ? {} : { details: exception.details }),
      };
      return { status: httpStatusForError(exception.code), body: { error } };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = this.codeForHttpStatus(status);
      return {
        status,
        body: { error: { code, message: this.safeMessageForHttpStatus(status), requestId } },
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'An unexpected error occurred.',
          requestId,
        },
      },
    };
  }
  codeForHttpStatus(status) {
    if (status === NOT_FOUND_STATUS) return ERROR_CODES.RESOURCE_NOT_FOUND;
    return status >= INTERNAL_SERVER_ERROR_STATUS
      ? ERROR_CODES.INTERNAL_ERROR
      : ERROR_CODES.INVALID_REQUEST;
  }
  safeMessageForHttpStatus(status) {
    if (status === NOT_FOUND_STATUS) return 'Resource not found.';
    if (status >= INTERNAL_SERVER_ERROR_STATUS) return 'An unexpected error occurred.';
    return 'The request could not be processed.';
  }
}
