import { Global, Module } from '@nestjs/common';
import { AuthorizationGuard } from './authorization.guard.js';
import { AuthorizationService } from './authorization.service.js';

@Global()
@Module({
  providers: [AuthorizationService, AuthorizationGuard],
  exports: [AuthorizationService, AuthorizationGuard],
})
export class AuthorizationModule {}
