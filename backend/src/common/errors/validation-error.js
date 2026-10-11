import { ApplicationError } from './application-error.js';
import { ERROR_CODES } from './error-codes.js';
export class RequestValidationError extends ApplicationError {
  constructor(fields) {
    super(ERROR_CODES.VALIDATION_ERROR, 'Request validation failed.');
    this.name = RequestValidationError.name;
    this.fields = fields;
  }
}
