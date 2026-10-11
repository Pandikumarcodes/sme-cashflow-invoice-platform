import { ApplicationError } from '../errors/application-error.js';
import { ERROR_CODES } from '../errors/error-codes.js';

const trustedContexts = new WeakSet();

export function requireTenantContext(context) {
  if (!context || !trustedContexts.has(context)) {
    throw new ApplicationError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Organization not found.');
  }
  return context;
}

// The caller supplies authenticated identity, never a body/query object. Re-resolve
// using the transaction client before privileged work; a snapshot is not a cache.
export async function resolveTenantAccess(
  prisma,
  auth,
  organizationId,
  authorization,
  permissions,
) {
  if (!auth?.userId || !auth.sessionId || typeof organizationId !== 'string' || !organizationId) {
    throw new ApplicationError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Organization not found.');
  }
  if (trustedContexts.has(auth) && auth.organizationId !== organizationId) {
    throw new ApplicationError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Organization not found.');
  }
  const membership = await prisma.membership.findFirst({
    where: {
      organizationId,
      userId: auth.userId,
      status: 'ACTIVE',
      organization: { status: 'ACTIVE' },
    },
    include: { organization: true },
  });
  if (!membership) {
    throw new ApplicationError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Organization not found.');
  }
  if (!permissions?.length || !authorization.canAll(membership.role, permissions)) {
    throw new ApplicationError(ERROR_CODES.FORBIDDEN, 'Permission is not granted.');
  }
  const tenant = Object.freeze({
    userId: auth.userId,
    sessionId: auth.sessionId,
    organizationId: membership.organizationId,
    membershipId: membership.id,
    role: membership.role,
    membershipStatus: membership.status,
    // Authentication recency remains an auth concern, not membership authority.
    authenticatedAt: auth.authenticatedAt,
  });
  trustedContexts.add(tenant);
  return { tenant, membership };
}
