import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { normalizeEmail } from '../../auth/domain/email.js';
import { generateInvitationToken, hashInvitationToken } from '../domain/invitation-token.js';
import {
  ASSIGNABLE_MEMBERSHIP_ROLES,
  canTargetMembership,
  isRecentlyAuthenticated,
  isOwnerRole,
  OWNER_ROLE,
} from '../domain/membership-policy.js';
import { toInvitationResponse, toMembershipResponse } from '../membership-response.js';

const DAY_MS = 86_400_000;

@Injectable()
export class MembershipsService {
  constructor(prismaService, configService, authorization) {
    this.prismaService = prismaService;
    this.nodeEnv = configService.getOrThrow('app').nodeEnv;
    this.authorization = authorization;
  }

  async listMembers(auth, organizationId, filters = {}) {
    const prisma = await this.prismaService.getClient();
    await this.requireAuthorized(prisma, auth, organizationId, PERMISSIONS.MEMBERSHIP_READ);
    const memberships = await prisma.membership.findMany({
      where: {
        organizationId,
        ...(filters.role ? { role: filters.role } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: { user: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return memberships.map(toMembershipResponse);
  }

  async invite(auth, organizationId, input, metadata = {}) {
    if (!ASSIGNABLE_MEMBERSHIP_ROLES.includes(input.role)) {
      throw new ApplicationError(
        ERROR_CODES.OWNER_TRANSFER_REQUIRED,
        'Owner role cannot be granted by invitation.',
      );
    }
    const prisma = await this.prismaService.getClient();
    const now = new Date();
    const normalizedEmail = normalizeEmail(input.email);
    const rawToken = generateInvitationToken();
    const tokenHash = hashInvitationToken(rawToken);
    const expiresAt = new Date(now.getTime() + (input.expiresInDays ?? 7) * DAY_MS);
    try {
      const invitation = await prisma.$transaction(async (tx) => {
        const actor = await this.requireAuthorized(
          tx,
          auth,
          organizationId,
          PERMISSIONS.MEMBERSHIP_INVITE,
        );
        await tx.organizationInvitation.updateMany({
          where: {
            organizationId,
            normalizedEmail,
            status: 'PENDING',
            expiresAt: { lte: now },
          },
          data: { status: 'EXPIRED' },
        });
        const existingUser = await tx.user.findUnique({ where: { normalizedEmail } });
        if (existingUser) {
          const existingMembership = await tx.membership.findUnique({
            where: { organizationId_userId: { organizationId, userId: existingUser.id } },
          });
          if (existingMembership && existingMembership.status !== 'REMOVED') {
            throw new ApplicationError(
              ERROR_CODES.DUPLICATE_MEMBERSHIP,
              'User already has a membership in this organization.',
            );
          }
        }
        const created = await tx.organizationInvitation.create({
          data: {
            organizationId,
            email: normalizedEmail,
            normalizedEmail,
            role: input.role,
            tokenHash,
            expiresAt,
            invitedByUserId: auth.userId,
          },
        });
        await this.audit(tx, auth, actor, {
          organizationId,
          action: 'ORGANIZATION_INVITATION_CREATED',
          entityType: 'OrganizationInvitation',
          entityId: created.id,
          afterData: { email: normalizedEmail, role: input.role, status: 'PENDING', expiresAt },
          ...metadata,
        });
        return created;
      });
      return toInvitationResponse(invitation, this.nodeEnv === 'production' ? undefined : rawToken);
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new ApplicationError(
          ERROR_CODES.DUPLICATE_INVITATION,
          'A pending invitation already exists for this email.',
        );
      }
      throw error;
    }
  }

  async listInvitations(auth, organizationId, filters = {}) {
    const prisma = await this.prismaService.getClient();
    await this.requireAuthorized(prisma, auth, organizationId, PERMISSIONS.MEMBERSHIP_READ);
    const now = new Date();
    await prisma.organizationInvitation.updateMany({
      where: { organizationId, status: 'PENDING', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    const invitations = await prisma.organizationInvitation.findMany({
      where: {
        organizationId,
        ...(filters.status ? { status: filters.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return invitations.map((invitation) => toInvitationResponse(invitation));
  }

  async revokeInvitation(auth, organizationId, invitationId, metadata = {}) {
    const prisma = await this.prismaService.getClient();
    await prisma.$transaction(async (tx) => {
      const actor = await this.requireAuthorized(
        tx,
        auth,
        organizationId,
        PERMISSIONS.MEMBERSHIP_INVITE,
      );
      const invitation = await tx.organizationInvitation.findFirst({
        where: { id: invitationId, organizationId },
      });
      if (!invitation) throw this.notFound('Invitation');
      if (invitation.status !== 'PENDING') {
        throw new ApplicationError(
          ERROR_CODES.INVITATION_INVALID_OR_EXPIRED,
          'Invitation is no longer available.',
        );
      }
      const now = new Date();
      if (invitation.expiresAt <= now) {
        await tx.organizationInvitation.update({
          where: { id: invitation.id },
          data: { status: 'EXPIRED' },
        });
        return;
      }
      const revoked = await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: { status: 'REVOKED', revokedAt: now },
      });
      await this.audit(tx, auth, actor, {
        organizationId,
        action: 'ORGANIZATION_INVITATION_REVOKED',
        entityType: 'OrganizationInvitation',
        entityId: invitation.id,
        changedFields: ['status'],
        beforeData: { status: invitation.status },
        afterData: { status: revoked.status },
        ...metadata,
      });
    });
  }

  async acceptInvitation(auth, rawToken, metadata = {}) {
    const prisma = await this.prismaService.getClient();
    const tokenHash = hashInvitationToken(rawToken);
    let outcome;
    try {
      outcome = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "organization_invitations" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
        const invitation = await tx.organizationInvitation.findUnique({
          where: { tokenHash },
          include: { organization: true },
        });
        if (
          !invitation ||
          invitation.status !== 'PENDING' ||
          invitation.normalizedEmail !== auth.user.normalizedEmail ||
          invitation.organization.status !== 'ACTIVE'
        ) {
          return { status: 'INVALID' };
        }
        const now = new Date();
        if (invitation.expiresAt <= now) {
          await tx.organizationInvitation.update({
            where: { id: invitation.id },
            data: { status: 'EXPIRED' },
          });
          return { status: 'INVALID' };
        }
        const existing = await tx.membership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: invitation.organizationId,
              userId: auth.userId,
            },
          },
        });
        if (existing && existing.status !== 'REMOVED') return { status: 'DUPLICATE' };
        const membership = existing
          ? await tx.membership.update({
              where: { id: existing.id },
              data: {
                role: invitation.role,
                status: 'ACTIVE',
                joinedAt: existing.joinedAt ?? now,
                suspendedAt: null,
                removedAt: null,
                version: { increment: 1 },
              },
              include: { user: true },
            })
          : await tx.membership.create({
              data: {
                organizationId: invitation.organizationId,
                userId: auth.userId,
                role: invitation.role,
                status: 'ACTIVE',
                joinedAt: now,
              },
              include: { user: true },
            });
        await tx.organizationInvitation.update({
          where: { id: invitation.id },
          data: {
            status: 'ACCEPTED',
            acceptedByUserId: auth.userId,
            acceptedAt: now,
          },
        });
        await this.audit(tx, auth, membership, {
          organizationId: invitation.organizationId,
          action: 'ORGANIZATION_INVITATION_ACCEPTED',
          entityType: 'OrganizationInvitation',
          entityId: invitation.id,
          changedFields: ['status'],
          beforeData: { status: 'PENDING' },
          afterData: { status: 'ACCEPTED', membershipId: membership.id },
          ...metadata,
        });
        return { status: 'ACCEPTED', membership };
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new ApplicationError(
          ERROR_CODES.DUPLICATE_MEMBERSHIP,
          'User already has a membership in this organization.',
        );
      }
      throw error;
    }
    if (outcome.status === 'DUPLICATE') {
      throw new ApplicationError(
        ERROR_CODES.DUPLICATE_MEMBERSHIP,
        'User already has a membership in this organization.',
      );
    }
    if (outcome.status !== 'ACCEPTED') throw this.invalidInvitation();
    return toMembershipResponse(outcome.membership);
  }

  async changeRole(auth, organizationId, membershipId, expectedVersion, role, metadata = {}) {
    if (!ASSIGNABLE_MEMBERSHIP_ROLES.includes(role)) {
      throw new ApplicationError(
        ERROR_CODES.OWNER_TRANSFER_REQUIRED,
        'Owner role changes require ownership transfer.',
      );
    }
    return this.mutateMembership(
      auth,
      organizationId,
      membershipId,
      expectedVersion,
      'MEMBERSHIP_ROLE_CHANGED',
      PERMISSIONS.MEMBERSHIP_CHANGE_ROLE,
      (target) => ({
        data: { role, version: { increment: 1 } },
        changedFields: ['role'],
        beforeData: { role: target.role },
        afterData: { role },
      }),
      metadata,
    );
  }

  suspend(auth, organizationId, membershipId, expectedVersion, metadata = {}) {
    return this.mutateMembership(
      auth,
      organizationId,
      membershipId,
      expectedVersion,
      'MEMBERSHIP_SUSPENDED',
      PERMISSIONS.MEMBERSHIP_SUSPEND,
      (target, now) => {
        if (target.status !== 'ACTIVE') throw this.invalidMembershipStatus('ACTIVE');
        return {
          data: { status: 'SUSPENDED', suspendedAt: now, version: { increment: 1 } },
          changedFields: ['status'],
          beforeData: { status: target.status },
          afterData: { status: 'SUSPENDED' },
        };
      },
      metadata,
    );
  }

  reactivate(auth, organizationId, membershipId, expectedVersion, metadata = {}) {
    return this.mutateMembership(
      auth,
      organizationId,
      membershipId,
      expectedVersion,
      'MEMBERSHIP_REACTIVATED',
      PERMISSIONS.MEMBERSHIP_SUSPEND,
      (target) => {
        if (!['SUSPENDED', 'REMOVED'].includes(target.status)) {
          throw this.invalidMembershipStatus('SUSPENDED or REMOVED');
        }
        return {
          data: {
            status: 'ACTIVE',
            joinedAt: target.joinedAt ?? new Date(),
            suspendedAt: null,
            removedAt: null,
            version: { increment: 1 },
          },
          changedFields: ['status'],
          beforeData: { status: target.status },
          afterData: { status: 'ACTIVE' },
        };
      },
      metadata,
    );
  }

  async remove(auth, organizationId, membershipId, expectedVersion, metadata = {}) {
    await this.mutateMembership(
      auth,
      organizationId,
      membershipId,
      expectedVersion,
      'MEMBERSHIP_REMOVED',
      PERMISSIONS.MEMBERSHIP_REMOVE,
      (target, now) => {
        if (!['ACTIVE', 'SUSPENDED'].includes(target.status)) {
          throw this.invalidMembershipStatus('ACTIVE or SUSPENDED');
        }
        return {
          data: {
            status: 'REMOVED',
            suspendedAt: null,
            removedAt: now,
            version: { increment: 1 },
          },
          changedFields: ['status'],
          beforeData: { status: target.status },
          afterData: { status: 'REMOVED' },
        };
      },
      metadata,
    );
  }

  async transferOwnership(auth, organizationId, targetMembershipId, metadata = {}) {
    if (!isRecentlyAuthenticated(auth.authenticatedAt)) {
      throw new ApplicationError(
        ERROR_CODES.REAUTHENTICATION_REQUIRED,
        'Recent authentication is required.',
      );
    }
    const prisma = await this.prismaService.getClient();
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "organizations" WHERE "id" = ${organizationId}::uuid FOR UPDATE`;
      const actor = await this.requireAuthorized(
        tx,
        auth,
        organizationId,
        PERMISSIONS.ORGANIZATION_TRANSFER_OWNERSHIP,
      );
      const initialTarget = await tx.membership.findFirst({
        where: { id: targetMembershipId, organizationId },
      });
      if (!initialTarget) throw this.notFound('Membership');
      if (initialTarget.id === actor.id || initialTarget.status !== 'ACTIVE') {
        throw new ApplicationError(
          ERROR_CODES.INVALID_MEMBERSHIP_STATUS,
          'Ownership target must be another active member.',
        );
      }
      const lockIds = [actor.id, initialTarget.id].sort();
      await tx.$queryRaw`SELECT "id" FROM "memberships" WHERE "id" IN (${lockIds[0]}::uuid, ${lockIds[1]}::uuid) ORDER BY "id" FOR UPDATE`;
      const [currentOwner, target] = await Promise.all([
        tx.membership.findFirst({
          where: { id: actor.id, organizationId, status: 'ACTIVE', role: OWNER_ROLE },
          include: { user: true },
        }),
        tx.membership.findFirst({
          where: { id: targetMembershipId, organizationId, status: 'ACTIVE' },
          include: { user: true },
        }),
      ]);
      if (!currentOwner || !target || isOwnerRole(target.role)) {
        throw new ApplicationError(
          ERROR_CODES.CONCURRENT_MODIFICATION,
          'Ownership changed during transfer.',
        );
      }
      const previousOwner = await tx.membership.update({
        where: { id: currentOwner.id },
        data: { role: 'ADMIN', version: { increment: 1 } },
        include: { user: true },
      });
      const newOwner = await tx.membership.update({
        where: { id: target.id },
        data: { role: 'OWNER', version: { increment: 1 } },
        include: { user: true },
      });
      await tx.organization.update({
        where: { id: organizationId },
        data: { version: { increment: 1 } },
      });
      await this.audit(tx, auth, currentOwner, {
        organizationId,
        action: 'ORGANIZATION_OWNERSHIP_TRANSFERRED',
        entityType: 'Organization',
        entityId: organizationId,
        changedFields: ['ownerMembershipId'],
        beforeData: { ownerMembershipId: previousOwner.id },
        afterData: { ownerMembershipId: newOwner.id },
        ...metadata,
      });
      return { previousOwner, newOwner };
    });
    return {
      previousOwner: toMembershipResponse(result.previousOwner),
      currentOwner: toMembershipResponse(result.newOwner),
    };
  }

  async mutateMembership(
    auth,
    organizationId,
    membershipId,
    expectedVersion,
    action,
    permission,
    buildMutation,
    metadata,
  ) {
    const prisma = await this.prismaService.getClient();
    const membership = await prisma.$transaction(async (tx) => {
      const actor = await this.requireAuthorized(tx, auth, organizationId, permission);
      const target = await tx.membership.findFirst({
        where: { id: membershipId, organizationId },
        include: { user: true },
      });
      if (!target) throw this.notFound('Membership');
      if (!canTargetMembership(actor.role, target.role)) {
        throw new ApplicationError(
          isOwnerRole(target.role) ? ERROR_CODES.OWNER_TRANSFER_REQUIRED : ERROR_CODES.FORBIDDEN,
          isOwnerRole(target.role)
            ? 'Owner changes require ownership transfer.'
            : 'Membership change is not allowed.',
        );
      }
      const now = new Date();
      const mutation = buildMutation(target, now);
      const changed = await tx.membership.updateMany({
        where: { id: membershipId, organizationId, version: expectedVersion },
        data: mutation.data,
      });
      if (changed.count !== 1) {
        throw new ApplicationError(
          ERROR_CODES.CONCURRENT_MODIFICATION,
          'Membership version does not match.',
        );
      }
      const updated = await tx.membership.findFirstOrThrow({
        where: { id: membershipId, organizationId },
        include: { user: true },
      });
      await this.audit(tx, auth, actor, {
        organizationId,
        action,
        entityType: 'Membership',
        entityId: membershipId,
        changedFields: mutation.changedFields,
        beforeData: mutation.beforeData,
        afterData: mutation.afterData,
        ...metadata,
      });
      return updated;
    });
    return toMembershipResponse(membership);
  }

  async requireAuthorized(prisma, auth, organizationId, permission) {
    const actor = await prisma.membership.findFirst({
      where: { organizationId, userId: auth.userId, status: 'ACTIVE' },
      include: { organization: true },
    });
    if (!actor) throw this.notFound('Organization');
    if (actor.organization.status !== 'ACTIVE') {
      throw new ApplicationError(
        ERROR_CODES.INVALID_ORGANIZATION_STATUS,
        'Organization is not active.',
      );
    }
    this.authorization.assertPermission(actor.role, permission);
    return actor;
  }

  invalidInvitation() {
    return new ApplicationError(
      ERROR_CODES.INVITATION_INVALID_OR_EXPIRED,
      'Invitation is invalid or no longer available.',
    );
  }

  invalidMembershipStatus(expected) {
    return new ApplicationError(
      ERROR_CODES.INVALID_MEMBERSHIP_STATUS,
      `Membership must be ${expected}.`,
    );
  }

  notFound(entity) {
    return new ApplicationError(ERROR_CODES.RESOURCE_NOT_FOUND, `${entity} not found.`);
  }

  audit(tx, auth, actorMembership, event) {
    return tx.auditLog.create({
      data: {
        organizationId: event.organizationId,
        actorType: 'USER',
        actorUserId: auth.userId,
        actorMembershipId: actorMembership.id,
        actorSessionId: auth.sessionId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        outcome: 'SUCCESS',
        changedFields: event.changedFields,
        beforeData: event.beforeData,
        afterData: event.afterData,
        requestId: event.requestId,
        correlationId: event.correlationId,
        source: 'API',
      },
    });
  }
}
Inject(PrismaService)(MembershipsService, undefined, 0);
Inject(ConfigService)(MembershipsService, undefined, 1);
Inject(AuthorizationService)(MembershipsService, undefined, 2);
