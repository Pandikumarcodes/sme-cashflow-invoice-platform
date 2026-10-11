import { Inject, Injectable, ParseUUIDPipe } from '@nestjs/common';
import { resolveTenantAccess } from '../tenancy/tenant-context.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuthorizationService } from './authorization.service.js';
import { REQUIRED_PERMISSIONS } from './require-permissions.decorator.js';

@Injectable()
export class AuthorizationGuard {
  constructor(prismaService, authorization) {
    this.prismaService = prismaService;
    this.authorization = authorization;
  }

  async canActivate(context) {
    const permissions = Reflect.getMetadata(REQUIRED_PERMISSIONS, context.getHandler());
    if (!permissions?.length) return true;
    const request = context.switchToHttp().getRequest();
    const organizationId = request.params?.organizationId;
    await new ParseUUIDPipe({ version: '4' }).transform(organizationId, {
      type: 'param',
      data: 'organizationId',
    });
    const prisma = await this.prismaService.getClient();
    const { tenant } = await resolveTenantAccess(
      prisma,
      request.auth,
      organizationId,
      this.authorization,
      permissions,
    );
    request.tenant = tenant;
    // Preserve the existing internal name as an alias to the single context.
    request.authorization = tenant;
    return true;
  }
}
Inject(PrismaService)(AuthorizationGuard, undefined, 0);
Inject(AuthorizationService)(AuthorizationGuard, undefined, 1);
