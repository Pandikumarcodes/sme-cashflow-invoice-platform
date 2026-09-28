import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../errors/application-error.js';
import { ERROR_CODES } from '../errors/error-codes.js';
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
    if (!request.auth || typeof organizationId !== 'string') {
      throw new ApplicationError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Organization not found.');
    }
    const prisma = await this.prismaService.getClient();
    const membership = await prisma.membership.findFirst({
      where: {
        organizationId,
        userId: request.auth.userId,
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      },
      select: { id: true, organizationId: true, role: true },
    });
    if (!membership) {
      throw new ApplicationError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Organization not found.');
    }
    if (!this.authorization.canAll(membership.role, permissions)) {
      throw new ApplicationError(ERROR_CODES.FORBIDDEN, 'Permission is not granted.');
    }
    request.authorization = Object.freeze({
      userId: request.auth.userId,
      sessionId: request.auth.sessionId,
      organizationId: membership.organizationId,
      membershipId: membership.id,
      role: membership.role,
      permissions: Object.freeze([...this.authorization.permissionsFor(membership.role)]),
    });
    return true;
  }
}
Inject(PrismaService)(AuthorizationGuard, undefined, 0);
Inject(AuthorizationService)(AuthorizationGuard, undefined, 1);
