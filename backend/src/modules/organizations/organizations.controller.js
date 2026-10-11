import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApplicationError } from '../../common/errors/application-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';
import { RequestContextStore } from '../../common/request-context/request-context.store.js';
import { AuthorizationGuard } from '../../common/authorization/authorization.guard.js';
import { PERMISSIONS } from '../../common/authorization/permissions.js';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator.js';
import { AccessAuthGuard } from '../auth/guards/access-auth.guard.js';
import { OrganizationsService } from './application/organizations.service.js';
import { CloseOrganizationDto } from './dto/close-organization.dto.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';

@Controller('organizations')
@UseGuards(AccessAuthGuard, AuthorizationGuard)
export class OrganizationsController {
  constructor(organizations, requestContext) {
    this.organizations = organizations;
    this.requestContext = requestContext;
  }

  @Post()
  async create(input, request) {
    const organization = await this.organizations.create(request.auth, input, this.auditMetadata());
    return { data: organization };
  }

  @Get()
  async list(request) {
    return { data: await this.organizations.list(request.auth) };
  }

  @Get(':organizationId')
  async get(_organizationId, request) {
    return { data: await this.organizations.get(request.tenant, request.tenant.organizationId) };
  }

  @Patch(':organizationId')
  async update(_organizationId, ifMatch, input, request, response) {
    const organization = await this.organizations.update(
      request.tenant,
      request.tenant.organizationId,
      this.parseExpectedVersion(ifMatch),
      input,
      this.auditMetadata(),
    );
    response.setHeader('ETag', `"${organization.version}"`);
    return { data: organization };
  }

  @Post(':organizationId/close')
  @HttpCode(HttpStatus.OK)
  async close(_organizationId, input, request) {
    const organization = await this.organizations.close(
      request.tenant,
      request.tenant.organizationId,
      input.reason,
      this.auditMetadata(),
    );
    return { data: organization };
  }

  parseExpectedVersion(ifMatch) {
    const match = typeof ifMatch === 'string' ? /^(?:W\/)?"?(\d+)"?$/.exec(ifMatch.trim()) : null;
    const version = match ? Number(match[1]) : Number.NaN;
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new ApplicationError(
        ERROR_CODES.INVALID_REQUEST,
        'If-Match must contain a positive organization version.',
      );
    }
    return version;
  }

  auditMetadata() {
    const context = this.requestContext.get();
    return { requestId: context?.requestId, correlationId: context?.correlationId };
  }
}

Body()(OrganizationsController.prototype, 'create', 0);
Req()(OrganizationsController.prototype, 'create', 1);
Reflect.defineMetadata(
  'design:paramtypes',
  [CreateOrganizationDto, Object],
  OrganizationsController.prototype,
  'create',
);
Req()(OrganizationsController.prototype, 'list', 0);
Param('organizationId', new ParseUUIDPipe({ version: '4' }))(
  OrganizationsController.prototype,
  'get',
  0,
);
Req()(OrganizationsController.prototype, 'get', 1);
Param('organizationId', new ParseUUIDPipe({ version: '4' }))(
  OrganizationsController.prototype,
  'update',
  0,
);
Headers('if-match')(OrganizationsController.prototype, 'update', 1);
Body()(OrganizationsController.prototype, 'update', 2);
Req()(OrganizationsController.prototype, 'update', 3);
Res({ passthrough: true })(OrganizationsController.prototype, 'update', 4);
Reflect.defineMetadata(
  'design:paramtypes',
  [String, String, UpdateOrganizationDto, Object, Object],
  OrganizationsController.prototype,
  'update',
);
Param('organizationId', new ParseUUIDPipe({ version: '4' }))(
  OrganizationsController.prototype,
  'close',
  0,
);
Body()(OrganizationsController.prototype, 'close', 1);
Req()(OrganizationsController.prototype, 'close', 2);
Reflect.defineMetadata(
  'design:paramtypes',
  [String, CloseOrganizationDto, Object],
  OrganizationsController.prototype,
  'close',
);
Inject(OrganizationsService)(OrganizationsController, undefined, 0);
Inject(RequestContextStore)(OrganizationsController, undefined, 1);

for (const [method, permission] of [
  ['get', PERMISSIONS.ORGANIZATION_READ],
  ['update', PERMISSIONS.ORGANIZATION_UPDATE],
  ['close', PERMISSIONS.ORGANIZATION_CLOSE],
]) {
  RequirePermissions(permission)(
    OrganizationsController.prototype,
    method,
    Object.getOwnPropertyDescriptor(OrganizationsController.prototype, method),
  );
}
