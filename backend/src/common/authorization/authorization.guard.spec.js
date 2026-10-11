import { AuthorizationGuard } from './authorization.guard.js';
import { AuthorizationService } from './authorization.service.js';
import { PERMISSIONS } from './permissions.js';
import { RequirePermissions } from './require-permissions.decorator.js';

class ProtectedHandler {
  action() {}
}
RequirePermissions(PERMISSIONS.ORGANIZATION_UPDATE)(
  ProtectedHandler.prototype,
  'action',
  Object.getOwnPropertyDescriptor(ProtectedHandler.prototype, 'action'),
);

function executionContext(request) {
  return {
    getHandler: () => ProtectedHandler.prototype.action,
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

describe('AuthorizationGuard', () => {
  const authorization = new AuthorizationService();
  const auth = { userId: 'user-1', sessionId: 'session-1' };

  function guardFor(membership) {
    return new AuthorizationGuard(
      {
        getClient: async () => ({
          membership: { findFirst: async () => membership && { status: 'ACTIVE', ...membership } },
        }),
      },
      authorization,
    );
  }

  it('attaches a trusted authorization snapshot for an active member with permission', async () => {
    const request = {
      auth,
      params: { organizationId: '10000000-0000-4000-8000-000000000001' },
      body: { organizationId: '20000000-0000-4000-8000-000000000002', role: 'OWNER' },
      query: { organizationId: '20000000-0000-4000-8000-000000000002' },
      headers: { 'x-organization-id': '20000000-0000-4000-8000-000000000002' },
      tenant: { organizationId: '20000000-0000-4000-8000-000000000002', role: 'OWNER' },
    };
    await expect(
      guardFor({
        id: 'membership-1',
        organizationId: '10000000-0000-4000-8000-000000000001',
        role: 'ADMIN',
      }).canActivate(executionContext(request)),
    ).resolves.toBe(true);
    expect(request.tenant).toBe(request.authorization);
    expect(request.tenant.organizationId).toBe('10000000-0000-4000-8000-000000000001');
    expect(request.tenant.role).toBe('ADMIN');
    expect(request.tenant.permissions).toBeUndefined();
    expect(request.tenant.membershipStatus).toBe('ACTIVE');
    expect(request.authorization).toMatchObject({ role: 'ADMIN', membershipId: 'membership-1' });
    expect(Object.isFrozen(request.authorization)).toBe(true);
  });

  it('returns forbidden for an active member without the endpoint permission', async () => {
    await expect(
      guardFor({
        id: 'membership-1',
        organizationId: '10000000-0000-4000-8000-000000000001',
        role: 'VIEWER',
      }).canActivate(
        executionContext({
          auth,
          params: { organizationId: '10000000-0000-4000-8000-000000000001' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects malformed requested tenant IDs before database access', async () => {
    const guard = new AuthorizationGuard(
      {
        getClient: async () => {
          throw new Error('must not contact persistence for invalid UUID');
        },
      },
      authorization,
    );
    await expect(
      guard.canActivate(
        executionContext({
          auth,
          params: { organizationId: 'not-a-uuid' },
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('conceals non-member and inactive membership access', async () => {
    await expect(
      guardFor(null).canActivate(
        executionContext({
          auth,
          params: { organizationId: '10000000-0000-4000-8000-000000000001' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
