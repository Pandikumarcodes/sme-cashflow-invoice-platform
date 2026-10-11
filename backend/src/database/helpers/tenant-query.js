import { requireTenantContext } from '../../common/tenancy/tenant-context.js';
import { ApplicationError } from '../../common/errors/application-error.js';
import { ERROR_CODES } from '../../common/errors/error-codes.js';

export function tenantWhere(tenant, filters = {}) {
  const { organizationId } = requireTenantContext(tenant);
  // AND prevents additional OR/filter clauses from replacing the tenant fence.
  return { AND: [{ organizationId }, filters] };
}

export function tenantResourceWhere(tenant, resourceId) {
  const { organizationId } = requireTenantContext(tenant);
  if (typeof resourceId !== 'string' || !resourceId) {
    throw new ApplicationError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Resource not found.');
  }
  // Also works with Prisma's extended unique update predicates.
  return { id: resourceId, organizationId };
}

export function requireTenantResource(resource, entity = 'Resource') {
  if (!resource) {
    throw new ApplicationError(ERROR_CODES.RESOURCE_NOT_FOUND, `${entity} not found.`);
  }
  return resource;
}
