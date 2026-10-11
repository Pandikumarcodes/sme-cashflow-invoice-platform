import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { toSafeUser } from '../domain/safe-user.js';
import { AccessAuthGuard } from '../guards/access-auth.guard.js';

@Controller('me')
@UseGuards(AccessAuthGuard)
export class MeController {
  @Get()
  getCurrentUser(request) {
    return { data: toSafeUser(request.auth.user) };
  }
}
Req()(MeController.prototype, 'getCurrentUser', 0);
