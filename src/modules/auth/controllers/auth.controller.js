import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestContextStore } from '../../../common/request-context/request-context.store.js';
import { AuthService } from '../application/auth.service.js';
import { EmptyAuthDto } from '../dto/empty-auth.dto.js';
import { LoginDto } from '../dto/login.dto.js';
import { RegisterDto } from '../dto/register.dto.js';
import { AccessAuthGuard } from '../guards/access-auth.guard.js';
import { AuthRateLimit, AuthRateLimitGuard } from '../guards/auth-rate-limit.guard.js';

@Controller('auth')
@UseGuards(AuthRateLimitGuard)
export class AuthController {
  constructor(authService, configService, requestContext) {
    this.authService = authService;
    this.config = configService.getOrThrow('auth');
    this.requestContext = requestContext;
  }

  @Post('register')
  @AuthRateLimit('register')
  async register(input) {
    const user = await this.authService.register(input, this.metadata());
    return { data: user };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @AuthRateLimit('login')
  async login(input, request, response) {
    const result = await this.authService.login(input, this.metadata(request));
    this.setRefreshCookie(response, result.refreshToken, result.refreshExpiresAt);
    return {
      data: {
        accessToken: result.accessToken,
        tokenType: result.tokenType,
        expiresIn: result.expiresIn,
        user: result.user,
      },
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @AuthRateLimit('refresh')
  async refresh(_input, request, response) {
    try {
      const result = await this.authService.refresh(
        request.cookies?.[this.config.cookieName],
        this.metadata(request),
      );
      this.setRefreshCookie(response, result.refreshToken, result.refreshExpiresAt);
      return {
        data: {
          accessToken: result.accessToken,
          tokenType: result.tokenType,
          expiresIn: result.expiresIn,
        },
      };
    } catch (error) {
      this.clearRefreshCookie(response);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(_input, request, response) {
    const authorization = request.headers.authorization;
    await this.authService.logout({
      rawAccessToken:
        typeof authorization === 'string' && authorization.startsWith('Bearer ')
          ? authorization.slice(7)
          : undefined,
      rawRefreshToken: request.cookies?.[this.config.cookieName],
      metadata: this.metadata(request),
    });
    this.clearRefreshCookie(response);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AccessAuthGuard)
  async logoutAll(_input, request, response) {
    await this.authService.logoutAll(request.auth, this.requestContext.get()?.requestId);
    this.clearRefreshCookie(response);
  }

  metadata(request = {}) {
    return {
      requestId: this.requestContext.get()?.requestId,
      ip: request.ip,
      userAgent: request.headers?.['user-agent'],
      origin: request.headers?.origin,
    };
  }

  setRefreshCookie(response, value, expires) {
    response.cookie(this.config.cookieName, value, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: this.config.cookiePath,
      expires,
    });
  }

  clearRefreshCookie(response) {
    response.clearCookie(this.config.cookieName, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: this.config.cookiePath,
    });
  }
}
Body()(AuthController.prototype, 'register', 0);
Reflect.defineMetadata('design:paramtypes', [RegisterDto], AuthController.prototype, 'register');
Body()(AuthController.prototype, 'login', 0);
Reflect.defineMetadata(
  'design:paramtypes',
  [LoginDto, Object, Object],
  AuthController.prototype,
  'login',
);
Req()(AuthController.prototype, 'login', 1);
Res({ passthrough: true })(AuthController.prototype, 'login', 2);
Body()(AuthController.prototype, 'refresh', 0);
Req()(AuthController.prototype, 'refresh', 1);
Res({ passthrough: true })(AuthController.prototype, 'refresh', 2);
Body()(AuthController.prototype, 'logout', 0);
Req()(AuthController.prototype, 'logout', 1);
Res({ passthrough: true })(AuthController.prototype, 'logout', 2);
Body()(AuthController.prototype, 'logoutAll', 0);
Req()(AuthController.prototype, 'logoutAll', 1);
Res({ passthrough: true })(AuthController.prototype, 'logoutAll', 2);
Reflect.defineMetadata(
  'design:paramtypes',
  [EmptyAuthDto, Object, Object],
  AuthController.prototype,
  'refresh',
);
Reflect.defineMetadata(
  'design:paramtypes',
  [EmptyAuthDto, Object, Object],
  AuthController.prototype,
  'logout',
);
Reflect.defineMetadata(
  'design:paramtypes',
  [EmptyAuthDto, Object, Object],
  AuthController.prototype,
  'logoutAll',
);
Inject(AuthService)(AuthController, undefined, 0);
Inject(ConfigService)(AuthController, undefined, 1);
Inject(RequestContextStore)(AuthController, undefined, 2);
