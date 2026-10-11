import { jest } from '@jest/globals';
import { AuthorizationService } from '../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../common/authorization/permissions.js';
import { resolveTenantAccess } from '../../common/tenancy/tenant-context.js';
import { tenantWhere, tenantResourceWhere, requireTenantResource } from './tenant-query.js';

describe('trusted tenant query predicates', () => {
  const auth = { userId: 'user-a', sessionId: 'session-a' };
  const authorization = new AuthorizationService();
  let tenant;

  beforeEach(async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'membership-a',
      organizationId: 'organization-a',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    ({ tenant } = await resolveTenantAccess(
      { membership: { findFirst } },
      auth,
      'organization-a',
      authorization,
      [PERMISSIONS.MEMBERSHIP_READ],
    ));
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: 'organization-a',
        userId: 'user-a',
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      },
      include: { organization: true },
    });
  });

  it('requires a resolved context, rejecting client objects and copied snapshots', () => {
    for (const forged of [undefined, { organizationId: 'organization-a' }, { ...tenant }]) {
      expect(() => tenantWhere(forged)).toThrow('Organization not found.');
      expect(() => tenantResourceWhere(forged, 'resource-a')).toThrow('Organization not found.');
    }
    expect(Object.isFrozen(tenant)).toBe(true);
  });

  it('keeps tenant scope outside additional organization and OR filters', () => {
    const filters = { organizationId: 'organization-b', OR: [{ id: 'resource-b' }, {}] };
    expect(tenantWhere(tenant, filters)).toEqual({
      AND: [{ organizationId: 'organization-a' }, filters],
    });
    expect(tenantResourceWhere(tenant, 'resource-a')).toEqual({
      id: 'resource-a',
      organizationId: 'organization-a',
    });
  });

  it('rejects missing resource IDs instead of broadening a query', () => {
    for (const id of [undefined, null, '']) {
      expect(() => tenantResourceWhere(tenant, id)).toThrow('Resource not found.');
    }
  });

  it('returns accessible resources and conceals absent resources consistently', () => {
    const resource = { id: 'resource-a' };
    expect(requireTenantResource(resource, 'Membership')).toBe(resource);
    expect(() => requireTenantResource(null, 'Membership')).toThrow('Membership not found.');
  });

  it('does not reuse snapshots or switch the scope of an existing context', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = { membership: { findFirst } };
    await expect(
      resolveTenantAccess(prisma, tenant, 'organization-a', authorization, [
        PERMISSIONS.MEMBERSHIP_READ,
      ]),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(findFirst).toHaveBeenCalledTimes(1);
    await expect(
      resolveTenantAccess(prisma, tenant, 'organization-b', authorization, [
        PERMISSIONS.MEMBERSHIP_READ,
      ]),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('fails closed for unknown roles and missing permission requirements', async () => {
    const prisma = {
      membership: {
        findFirst: async () => ({
          id: 'membership-a',
          organizationId: 'organization-a',
          role: 'UNKNOWN',
        }),
      },
    };
    await expect(
      resolveTenantAccess(prisma, auth, 'organization-a', authorization, [
        PERMISSIONS.MEMBERSHIP_READ,
      ]),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      resolveTenantAccess(prisma, auth, 'organization-a', authorization, []),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
