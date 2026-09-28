import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { MembershipsService } from './application/memberships.service.js';
import { AcceptInvitationDto } from './dto/accept-invitation.dto.js';
import { ChangeMemberRoleDto } from './dto/change-member-role.dto.js';
import { EmptyMembershipCommandDto } from './dto/empty-membership-command.dto.js';
import { InvitationListQueryDto } from './dto/invitation-list-query.dto.js';
import { InviteMemberDto } from './dto/invite-member.dto.js';
import { MemberListQueryDto } from './dto/member-list-query.dto.js';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto.js';

@Controller('organizations/:organizationId')
@UseGuards(AccessAuthGuard, AuthorizationGuard)
export class MembershipsController {
  constructor(memberships, requestContext) {
    this.memberships = memberships;
    this.requestContext = requestContext;
  }

  @Get('members')
  async listMembers(organizationId, query, request) {
    return { data: await this.memberships.listMembers(request.auth, organizationId, query) };
  }

  @Post('invitations')
  async invite(organizationId, input, request) {
    return {
      data: await this.memberships.invite(
        request.auth,
        organizationId,
        input,
        this.auditMetadata(),
      ),
    };
  }

  @Get('invitations')
  async listInvitations(organizationId, query, request) {
    return { data: await this.memberships.listInvitations(request.auth, organizationId, query) };
  }

  @Delete('invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvitation(organizationId, invitationId, request) {
    await this.memberships.revokeInvitation(
      request.auth,
      organizationId,
      invitationId,
      this.auditMetadata(),
    );
  }

  @Patch('members/:membershipId')
  async changeRole(organizationId, membershipId, ifMatch, input, request, response) {
    const membership = await this.memberships.changeRole(
      request.auth,
      organizationId,
      membershipId,
      this.parseExpectedVersion(ifMatch),
      input.role,
      this.auditMetadata(),
    );
    return this.versionedResponse(response, membership);
  }

  @Post('members/:membershipId/suspend')
  @HttpCode(HttpStatus.OK)
  async suspend(organizationId, membershipId, ifMatch, _input, request, response) {
    const membership = await this.memberships.suspend(
      request.auth,
      organizationId,
      membershipId,
      this.parseExpectedVersion(ifMatch),
      this.auditMetadata(),
    );
    return this.versionedResponse(response, membership);
  }

  @Post('members/:membershipId/reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivate(organizationId, membershipId, ifMatch, _input, request, response) {
    const membership = await this.memberships.reactivate(
      request.auth,
      organizationId,
      membershipId,
      this.parseExpectedVersion(ifMatch),
      this.auditMetadata(),
    );
    return this.versionedResponse(response, membership);
  }

  @Delete('members/:membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(organizationId, membershipId, ifMatch, request) {
    await this.memberships.remove(
      request.auth,
      organizationId,
      membershipId,
      this.parseExpectedVersion(ifMatch),
      this.auditMetadata(),
    );
  }

  @Post('transfer-ownership')
  @HttpCode(HttpStatus.OK)
  async transferOwnership(organizationId, input, request) {
    return {
      data: await this.memberships.transferOwnership(
        request.auth,
        organizationId,
        input.targetMembershipId,
        this.auditMetadata(),
      ),
    };
  }

  parseExpectedVersion(ifMatch) {
    const match = typeof ifMatch === 'string' ? /^(?:W\/)?"?(\d+)"?$/.exec(ifMatch.trim()) : null;
    const version = match ? Number(match[1]) : Number.NaN;
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new ApplicationError(
        ERROR_CODES.INVALID_REQUEST,
        'If-Match must contain a positive membership version.',
      );
    }
    return version;
  }

  versionedResponse(response, membership) {
    response.setHeader('ETag', `"${membership.version}"`);
    return { data: membership };
  }

  auditMetadata() {
    const context = this.requestContext.get();
    return { requestId: context?.requestId, correlationId: context?.correlationId };
  }
}

@Controller('invitations')
@UseGuards(AccessAuthGuard)
export class InvitationAcceptanceController {
  constructor(memberships, requestContext) {
    this.memberships = memberships;
    this.requestContext = requestContext;
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  async accept(input, request, response) {
    const context = this.requestContext.get();
    const membership = await this.memberships.acceptInvitation(request.auth, input.token, {
      requestId: context?.requestId,
      correlationId: context?.correlationId,
    });
    response.setHeader('ETag', `"${membership.version}"`);
    return { data: membership };
  }
}

const organizationIdPipe = () => new ParseUUIDPipe({ version: '4' });
const resourceIdPipe = () => new ParseUUIDPipe({ version: '4' });

Param('organizationId', organizationIdPipe())(MembershipsController.prototype, 'listMembers', 0);
Query()(MembershipsController.prototype, 'listMembers', 1);
Req()(MembershipsController.prototype, 'listMembers', 2);
Reflect.defineMetadata(
  'design:paramtypes',
  [String, MemberListQueryDto, Object],
  MembershipsController.prototype,
  'listMembers',
);
Param('organizationId', organizationIdPipe())(MembershipsController.prototype, 'invite', 0);
Body()(MembershipsController.prototype, 'invite', 1);
Req()(MembershipsController.prototype, 'invite', 2);
Reflect.defineMetadata(
  'design:paramtypes',
  [String, InviteMemberDto, Object],
  MembershipsController.prototype,
  'invite',
);
Param('organizationId', organizationIdPipe())(
  MembershipsController.prototype,
  'listInvitations',
  0,
);
Query()(MembershipsController.prototype, 'listInvitations', 1);
Req()(MembershipsController.prototype, 'listInvitations', 2);
Reflect.defineMetadata(
  'design:paramtypes',
  [String, InvitationListQueryDto, Object],
  MembershipsController.prototype,
  'listInvitations',
);
Param('organizationId', organizationIdPipe())(
  MembershipsController.prototype,
  'revokeInvitation',
  0,
);
Param('invitationId', resourceIdPipe())(MembershipsController.prototype, 'revokeInvitation', 1);
Req()(MembershipsController.prototype, 'revokeInvitation', 2);
Param('organizationId', organizationIdPipe())(MembershipsController.prototype, 'changeRole', 0);
Param('membershipId', resourceIdPipe())(MembershipsController.prototype, 'changeRole', 1);
Headers('if-match')(MembershipsController.prototype, 'changeRole', 2);
Body()(MembershipsController.prototype, 'changeRole', 3);
Req()(MembershipsController.prototype, 'changeRole', 4);
Res({ passthrough: true })(MembershipsController.prototype, 'changeRole', 5);
Reflect.defineMetadata(
  'design:paramtypes',
  [String, String, String, ChangeMemberRoleDto, Object, Object],
  MembershipsController.prototype,
  'changeRole',
);

for (const method of ['suspend', 'reactivate']) {
  Param('organizationId', organizationIdPipe())(MembershipsController.prototype, method, 0);
  Param('membershipId', resourceIdPipe())(MembershipsController.prototype, method, 1);
  Headers('if-match')(MembershipsController.prototype, method, 2);
  Body()(MembershipsController.prototype, method, 3);
  Req()(MembershipsController.prototype, method, 4);
  Res({ passthrough: true })(MembershipsController.prototype, method, 5);
  Reflect.defineMetadata(
    'design:paramtypes',
    [String, String, String, EmptyMembershipCommandDto, Object, Object],
    MembershipsController.prototype,
    method,
  );
}

Param('organizationId', organizationIdPipe())(MembershipsController.prototype, 'remove', 0);
Param('membershipId', resourceIdPipe())(MembershipsController.prototype, 'remove', 1);
Headers('if-match')(MembershipsController.prototype, 'remove', 2);
Req()(MembershipsController.prototype, 'remove', 3);
Param('organizationId', organizationIdPipe())(
  MembershipsController.prototype,
  'transferOwnership',
  0,
);
Body()(MembershipsController.prototype, 'transferOwnership', 1);
Req()(MembershipsController.prototype, 'transferOwnership', 2);
Reflect.defineMetadata(
  'design:paramtypes',
  [String, TransferOwnershipDto, Object],
  MembershipsController.prototype,
  'transferOwnership',
);
Body()(InvitationAcceptanceController.prototype, 'accept', 0);
Req()(InvitationAcceptanceController.prototype, 'accept', 1);
Res({ passthrough: true })(InvitationAcceptanceController.prototype, 'accept', 2);
Reflect.defineMetadata(
  'design:paramtypes',
  [AcceptInvitationDto, Object, Object],
  InvitationAcceptanceController.prototype,
  'accept',
);
Inject(MembershipsService)(MembershipsController, undefined, 0);
Inject(RequestContextStore)(MembershipsController, undefined, 1);
Inject(MembershipsService)(InvitationAcceptanceController, undefined, 0);
Inject(RequestContextStore)(InvitationAcceptanceController, undefined, 1);

for (const [method, permission] of [
  ['listMembers', PERMISSIONS.MEMBERSHIP_READ],
  ['invite', PERMISSIONS.MEMBERSHIP_INVITE],
  ['listInvitations', PERMISSIONS.MEMBERSHIP_READ],
  ['revokeInvitation', PERMISSIONS.MEMBERSHIP_INVITE],
  ['changeRole', PERMISSIONS.MEMBERSHIP_CHANGE_ROLE],
  ['suspend', PERMISSIONS.MEMBERSHIP_SUSPEND],
  ['reactivate', PERMISSIONS.MEMBERSHIP_SUSPEND],
  ['remove', PERMISSIONS.MEMBERSHIP_REMOVE],
  ['transferOwnership', PERMISSIONS.ORGANIZATION_TRANSFER_OWNERSHIP],
]) {
  RequirePermissions(permission)(
    MembershipsController.prototype,
    method,
    Object.getOwnPropertyDescriptor(MembershipsController.prototype, method),
  );
}
