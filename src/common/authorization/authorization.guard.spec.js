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
      { getClient: async () => ({ membership: { findFirst: async () => membership } }) },
      authorization,
    );
  }

  it('attaches a trusted authorization snapshot for an active member with permission', async () => {
    const request = { auth, params: { organizationId: 'organization-1' } };
    await expect(
      guardFor({ id: 'membership-1', organizationId: 'organization-1', role: 'ADMIN' }).canActivate(
        executionContext(request),
      ),
    ).resolves.toBe(true);
    expect(request.authorization).toMatchObject({ role: 'ADMIN', membershipId: 'membership-1' });
    expect(Object.isFrozen(request.authorization)).toBe(true);
  });

  it('returns forbidden for an active member without the endpoint permission', async () => {
    await expect(
      guardFor({
        id: 'membership-1',
        organizationId: 'organization-1',
        role: 'VIEWER',
      }).canActivate(executionContext({ auth, params: { organizationId: 'organization-1' } })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('conceals non-member and inactive membership access', async () => {
    await expect(
      guardFor(null).canActivate(
        executionContext({ auth, params: { organizationId: 'organization-1' } }),
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
