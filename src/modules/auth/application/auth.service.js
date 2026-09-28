import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { normalizeEmail } from '../domain/email.js';
import {
  classifyRefreshCredential,
  generateRefreshToken,
  hashRefreshToken,
} from '../domain/refresh-token.js';
import { toSafeUser } from '../domain/safe-user.js';
import { AccessTokenService } from '../tokens/access-token.service.js';
import { PasswordHasher } from '../tokens/password-hasher.js';

const DAY_MS = 86_400_000;

@Injectable()
export class AuthService {
  constructor(prismaService, passwordHasher, accessTokens, configService) {
    this.prismaService = prismaService;
    this.passwordHasher = passwordHasher;
    this.accessTokens = accessTokens;
    this.config = configService.getOrThrow('auth');
  }

  async register(input, metadata = {}) {
    const prisma = await this.prismaService.getClient();
    const normalizedEmail = normalizeEmail(input.email);
    const passwordHash = await this.passwordHasher.hash(input.password);
    try {
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: normalizedEmail,
            normalizedEmail,
            passwordHash,
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
          },
        });
        await this.audit(tx, {
          action: 'AUTH_USER_REGISTERED',
          entityType: 'User',
          entityId: created.id,
          actorUserId: created.id,
          requestId: metadata.requestId,
        });
        return created;
      });
      return toSafeUser(user);
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new ApplicationError(ERROR_CODES.EMAIL_UNAVAILABLE, 'Email is unavailable.');
      }
      throw error;
    }
  }

  async login(input, metadata = {}) {
    const prisma = await this.prismaService.getClient();
    const normalizedEmail = normalizeEmail(input.email);
    const user = await prisma.user.findUnique({ where: { normalizedEmail } });
    if (!user) {
      await this.passwordHasher.verifyDummy(input.password);
      throw this.invalidCredentials();
    }
    const validPassword = await this.passwordHasher.verify(user.passwordHash, input.password);
    if (!validPassword || user.status !== 'ACTIVE') throw this.invalidCredentials();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.refreshLifetimeDays * DAY_MS);
    const refreshToken = generateRefreshToken();
    const tokenHash = hashRefreshToken(refreshToken);
    const replacementHash = this.passwordHasher.needsRehash(user.passwordHash)
      ? await this.passwordHasher.hash(input.password)
      : undefined;
    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.refreshSession.create({
        data: {
          userId: user.id,
          expiresAt,
          lastUsedAt: now,
          createdIp: metadata.ip,
          createdUserAgent: metadata.userAgent?.slice(0, 512),
        },
      });
      await tx.refreshToken.create({ data: { sessionId: session.id, tokenHash, expiresAt } });
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: now, ...(replacementHash ? { passwordHash: replacementHash } : {}) },
      });
      await this.audit(tx, {
        action: 'AUTH_LOGIN_SUCCEEDED',
        entityType: 'RefreshSession',
        entityId: session.id,
        actorUserId: user.id,
        actorSessionId: session.id,
        requestId: metadata.requestId,
      });
      return { session, user: updatedUser };
    });
    return {
      ...(await this.accessTokens.issue(user.id, result.session.id)),
      refreshToken,
      refreshExpiresAt: expiresAt,
      user: toSafeUser(result.user),
    };
  }

  async refresh(rawToken, metadata = {}) {
    this.assertAllowedOrigin(metadata.origin);
    if (!rawToken) throw this.invalidSession();
    const prisma = await this.prismaService.getClient();
    const tokenHash = hashRefreshToken(rawToken);
    const now = new Date();
    const nextRawToken = generateRefreshToken();
    const nextTokenHash = hashRefreshToken(nextRawToken);
    const outcome = await this.executeSerializable(prisma, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "refresh_tokens" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { session: { include: { user: true } } },
      });
      if (!token) return { status: 'INVALID' };
      const { session } = token;
      const decision = classifyRefreshCredential(token, now);
      if (decision === 'REUSE') {
        await tx.refreshSession.updateMany({
          where: { id: session.id },
          data: { status: 'COMPROMISED', revokedAt: now, revokeReason: 'TOKEN_REUSE' },
        });
        await tx.refreshToken.updateMany({
          where: { sessionId: session.id, status: 'ACTIVE' },
          data: { status: 'REVOKED' },
        });
        await this.audit(tx, {
          action: 'AUTH_REFRESH_REUSE_DETECTED',
          entityType: 'RefreshSession',
          entityId: session.id,
          actorUserId: session.userId,
          actorSessionId: session.id,
          requestId: metadata.requestId,
          outcome: 'DENIED',
        });
        return { status: 'COMPROMISED' };
      }
      if (decision === 'INVALID') {
        if (session.status === 'ACTIVE' && session.expiresAt <= now) {
          await tx.refreshSession.update({
            where: { id: session.id },
            data: { status: 'EXPIRED', revokedAt: now, revokeReason: 'EXPIRED' },
          });
          await tx.refreshToken.updateMany({
            where: { sessionId: session.id, status: 'ACTIVE' },
            data: { status: 'REVOKED' },
          });
        }
        return { status: 'INVALID' };
      }
      await tx.refreshToken.update({
        where: { id: token.id },
        data: { status: 'USED', usedAt: now },
      });
      const replacement = await tx.refreshToken.create({
        data: { sessionId: session.id, tokenHash: nextTokenHash, expiresAt: session.expiresAt },
      });
      await tx.refreshToken.update({
        where: { id: token.id },
        data: { replacedByTokenId: replacement.id },
      });
      await tx.refreshSession.update({
        where: { id: session.id },
        data: { lastUsedAt: now },
      });
      return { status: 'ROTATED', session, user: session.user };
    });
    if (outcome.status === 'COMPROMISED') {
      throw new ApplicationError(ERROR_CODES.SESSION_COMPROMISED, 'Session is no longer valid.');
    }
    if (outcome.status !== 'ROTATED') throw this.invalidSession();
    return {
      ...(await this.accessTokens.issue(outcome.user.id, outcome.session.id)),
      refreshToken: nextRawToken,
      refreshExpiresAt: outcome.session.expiresAt,
    };
  }

  async authenticateAccess(rawToken) {
    try {
      const claims = await this.accessTokens.verify(rawToken);
      const prisma = await this.prismaService.getClient();
      const session = await prisma.refreshSession.findUnique({
        where: { id: claims.sid },
        include: { user: true },
      });
      if (
        !session ||
        session.userId !== claims.sub ||
        session.status !== 'ACTIVE' ||
        session.expiresAt <= new Date() ||
        session.user.status !== 'ACTIVE'
      ) {
        throw new Error('Inactive access context');
      }
      return {
        userId: session.userId,
        sessionId: session.id,
        authenticatedAt: new Date(claims.iat * 1_000),
        user: session.user,
      };
    } catch {
      throw new ApplicationError(ERROR_CODES.UNAUTHENTICATED, 'Authentication is required.');
    }
  }

  async logout({ rawAccessToken, rawRefreshToken, metadata = {} }) {
    this.assertAllowedOrigin(metadata.origin);
    const prisma = await this.prismaService.getClient();
    let sessionId;
    if (rawAccessToken) {
      const auth = await this.authenticateAccess(rawAccessToken);
      sessionId = auth.sessionId;
    } else if (rawRefreshToken) {
      const token = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(rawRefreshToken) },
      });
      sessionId = token?.sessionId;
    }
    if (!sessionId) return;
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const changed = await tx.refreshSession.updateMany({
        where: { id: sessionId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: now, revokeReason: 'LOGOUT' },
      });
      await tx.refreshToken.updateMany({
        where: { sessionId, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
      if (changed.count > 0) {
        const session = await tx.refreshSession.findUnique({ where: { id: sessionId } });
        await this.audit(tx, {
          action: 'AUTH_LOGOUT',
          entityType: 'RefreshSession',
          entityId: sessionId,
          actorUserId: session.userId,
          actorSessionId: sessionId,
          requestId: metadata.requestId,
        });
      }
    });
  }

  async logoutAll(auth, requestId) {
    const prisma = await this.prismaService.getClient();
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const sessions = await tx.refreshSession.findMany({
        where: { userId: auth.userId, status: 'ACTIVE' },
        select: { id: true },
      });
      const ids = sessions.map(({ id }) => id);
      await tx.refreshSession.updateMany({
        where: { id: { in: ids } },
        data: { status: 'REVOKED', revokedAt: now, revokeReason: 'LOGOUT_ALL' },
      });
      await tx.refreshToken.updateMany({
        where: { sessionId: { in: ids }, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
      await this.audit(tx, {
        action: 'AUTH_LOGOUT_ALL',
        entityType: 'User',
        entityId: auth.userId,
        actorUserId: auth.userId,
        actorSessionId: auth.sessionId,
        requestId,
      });
    });
  }

  assertAllowedOrigin(origin) {
    if (origin && !this.config.corsOrigins.includes(origin)) throw this.invalidSession();
  }

  invalidCredentials() {
    return new ApplicationError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password.');
  }

  invalidSession() {
    return new ApplicationError(ERROR_CODES.INVALID_SESSION, 'Session is no longer valid.');
  }

  async executeSerializable(prisma, operation) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await prisma.$transaction(operation, { isolationLevel: 'Serializable' });
      } catch (error) {
        const retryable =
          error?.code === 'P2034' ||
          (error?.code === 'P2010' && ['40001', '40P01'].includes(error?.meta?.code));
        if (!retryable || attempt === 2) throw error;
      }
    }
    throw new Error('Unreachable transaction retry state');
  }

  audit(tx, event) {
    return tx.auditLog.create({
      data: {
        actorType: 'USER',
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        outcome: event.outcome ?? 'SUCCESS',
        source: 'API',
        actorUserId: event.actorUserId,
        actorSessionId: event.actorSessionId,
        requestId: event.requestId,
      },
    });
  }
}
Inject(PrismaService)(AuthService, undefined, 0);
Inject(PasswordHasher)(AuthService, undefined, 1);
Inject(AccessTokenService)(AuthService, undefined, 2);
Inject(ConfigService)(AuthService, undefined, 3);
