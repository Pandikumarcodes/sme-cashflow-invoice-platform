import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { RequestContextStore } from '../../../common/request-context/request-context.store.js';
import { AuthService } from '../application/auth.service.js';

@Injectable()
export class AccessAuthGuard {
  constructor(authService, requestContext) {
    this.authService = authService;
    this.requestContext = requestContext;
  }

  async canActivate(context) {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      throw new ApplicationError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required.');
    }
    const auth = await this.authService.authenticateAccess(authorization.slice(7));
    request.auth = auth;
    const requestMetadata = this.requestContext.get();
    if (requestMetadata) requestMetadata.auth = auth;
    return true;
  }
}
Inject(AuthService)(AccessAuthGuard, undefined, 0);
Inject(RequestContextStore)(AccessAuthGuard, undefined, 1);
