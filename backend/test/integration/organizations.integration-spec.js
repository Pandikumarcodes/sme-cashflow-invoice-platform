import { OrganizationsService } from '../../src/modules/organizations/application/organizations.service.js';
import { AuthorizationService } from '../../src/common/authorization/authorization.service.js';
import { DEFAULT_EXPENSE_CATEGORIES } from '../../src/modules/organizations/domain/organization-defaults.js';
import { clearDatabase, createTestPrismaClient } from './database-test-helpers.js';

describe('organization persistence', () => {
  const prisma = createTestPrismaClient();
  const service = new OrganizationsService(
    { getClient: async () => prisma },
    new AuthorizationService(),
  );

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_owner_membership ON "memberships"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_owner_membership()');
    await clearDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_owner_membership ON "memberships"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_owner_membership()');
    await prisma.$disconnect();
  });

  async function createUser(email) {
    return prisma.user.create({
      data: {
        email,
        normalizedEmail: email,
        passwordHash: 'integration-only-hash',
        firstName: 'Test',
        lastName: 'User',
      },
    });
  }

  async function createOrganization(user, overrides = {}) {
    return service.create(
      { userId: user.id, sessionId: '10000000-0000-4000-8000-000000000001' },
      {
        legalName: 'Acme Private Limited',
        displayName: 'Acme',
        baseCurrency: 'INR',
        timezone: 'Asia/Kolkata',
        ...overrides,
      },
      { requestId: 'organization-integration-test' },
    );
  }

  it('atomically creates organization defaults, one Owner membership, and audit', async () => {
    const user = await createUser('owner@example.com');
    const organization = await createOrganization(user);

    expect(await prisma.organization.count()).toBe(1);
    expect(
      await prisma.invoiceSequence.findUnique({ where: { organizationId: organization.id } }),
    ).toMatchObject({ nextValue: 1n });
    expect(await prisma.expenseCategory.count({ where: { organizationId: organization.id } })).toBe(
      DEFAULT_EXPENSE_CATEGORIES.length,
    );
    expect(
      await prisma.membership.findFirst({ where: { organizationId: organization.id } }),
    ).toMatchObject({ userId: user.id, role: 'OWNER', status: 'ACTIVE' });
    expect(
      await prisma.auditLog.findFirst({ where: { organizationId: organization.id } }),
    ).toMatchObject({
      action: 'ORGANIZATION_CREATED',
      actorUserId: user.id,
      actorMembershipId: organization.membership.id,
    });
  });

  it('rolls back every creation record when Owner membership insertion fails', async () => {
    const user = await createUser('rollback@example.com');
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_owner_membership() RETURNS trigger AS $$
      BEGIN
        IF NEW."role" = 'OWNER' THEN
          RAISE EXCEPTION 'forced owner failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_owner_membership
      BEFORE INSERT ON "memberships"
      FOR EACH ROW EXECUTE FUNCTION test_fail_owner_membership()
    `);

    await expect(createOrganization(user)).rejects.toThrow();
    expect(await prisma.organization.count()).toBe(0);
    expect(await prisma.invoiceSequence.count()).toBe(0);
    expect(await prisma.expenseCategory.count()).toBe(0);
    expect(await prisma.membership.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('enforces durable membership uniqueness', async () => {
    const user = await createUser('unique@example.com');
    const organization = await createOrganization(user);
    await expect(
      prisma.membership.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: 'VIEWER',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('enforces at most one active Owner membership per organization', async () => {
    const owner = await createUser('owner-invariant@example.com');
    const secondUser = await createUser('second-owner@example.com');
    const organization = await createOrganization(owner);

    await expect(
      prisma.membership.create({
        data: {
          organizationId: organization.id,
          userId: secondUser.id,
          role: 'OWNER',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('lists only active organizations reached through the current user active memberships', async () => {
    const userA = await createUser('a@example.com');
    const userB = await createUser('b@example.com');
    const organizationA = await createOrganization(userA, { slug: 'organization-a' });
    const organizationB = await createOrganization(userB, { slug: 'organization-b' });
    await prisma.membership.create({
      data: {
        organizationId: organizationB.id,
        userId: userA.id,
        role: 'VIEWER',
        status: 'SUSPENDED',
      },
    });

    await expect(service.list({ userId: userA.id })).resolves.toEqual([
      expect.objectContaining({
        id: organizationA.id,
        membership: expect.objectContaining({ role: 'OWNER' }),
      }),
    ]);
  });

  it('conceals non-member access and denies suspended memberships', async () => {
    const owner = await createUser('owner-access@example.com');
    const outsider = await createUser('outsider@example.com');
    const organization = await createOrganization(owner);
    await prisma.membership.create({
      data: {
        organizationId: organization.id,
        userId: outsider.id,
        role: 'VIEWER',
        status: 'SUSPENDED',
      },
    });

    await expect(service.get({ userId: outsider.id }, organization.id)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(
      service.update({ userId: outsider.id }, organization.id, 1, { displayName: 'Attack' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('uses current membership role and tenant scope for every authorization decision', async () => {
    const owner = await createUser('rbac-owner@example.com');
    const member = await createUser('rbac-member@example.com');
    const otherOwner = await createUser('rbac-other-owner@example.com');
    const organization = await createOrganization(owner, { slug: 'rbac-current-role' });
    const otherOrganization = await createOrganization(otherOwner, { slug: 'rbac-other-tenant' });
    const membership = await prisma.membership.create({
      data: {
        organizationId: organization.id,
        userId: member.id,
        role: 'ADMIN',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
    const auth = { userId: member.id, sessionId: '10000000-0000-4000-8000-000000000003' };

    await expect(
      service.update(auth, organization.id, 1, { displayName: 'Allowed' }),
    ).resolves.toMatchObject({ version: 2 });
    await prisma.membership.update({ where: { id: membership.id }, data: { role: 'VIEWER' } });
    await expect(
      service.update(auth, organization.id, 2, { displayName: 'Denied' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.get(auth, otherOrganization.id)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    await expect(service.get(auth, organization.id)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('allows currency update before lock, then rejects it and persists update audits', async () => {
    const user = await createUser('currency@example.com');
    const created = await createOrganization(user);
    const auth = { userId: user.id, sessionId: '10000000-0000-4000-8000-000000000002' };
    const updated = await service.update(auth, created.id, 1, {
      baseCurrency: 'USD',
      timezone: 'America/New_York',
    });
    expect(updated).toMatchObject({
      baseCurrency: 'USD',
      timezone: 'America/New_York',
      version: 2,
    });
    await prisma.organization.update({
      where: { id: created.id },
      data: { currencyLockedAt: new Date() },
    });
    await expect(
      service.update(auth, created.id, 2, { baseCurrency: 'EUR' }),
    ).rejects.toMatchObject({ code: 'CURRENCY_LOCKED' });
    expect(await prisma.auditLog.count({ where: { action: 'ORGANIZATION_UPDATED' } })).toBe(1);
  });
});
