import { Module } from '@nestjs/common';
import { AuthService } from './application/auth.service.js';
import { AuthController } from './controllers/auth.controller.js';
import { MeController } from './controllers/me.controller.js';
import { AccessAuthGuard } from './guards/access-auth.guard.js';
import { AuthRateLimitGuard } from './guards/auth-rate-limit.guard.js';
import { AccessTokenService } from './tokens/access-token.service.js';
import { PasswordHasher } from './tokens/password-hasher.js';

@Module({
  controllers: [AuthController, MeController],
  providers: [AuthService, AccessTokenService, PasswordHasher, AccessAuthGuard, AuthRateLimitGuard],
  exports: [AccessAuthGuard, AuthService],
})
export class AuthModule {}
