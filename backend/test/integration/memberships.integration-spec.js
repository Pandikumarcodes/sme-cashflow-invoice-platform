import { MembershipsService } from '../../src/modules/memberships/application/memberships.service.js';
import { AuthorizationService } from '../../src/common/authorization/authorization.service.js';
import { hashInvitationToken } from '../../src/modules/memberships/domain/invitation-token.js';
import { OrganizationsService } from '../../src/modules/organizations/application/organizations.service.js';
import { clearDatabase, createTestPrismaClient } from './database-test-helpers.js';

describe('membership and invitation persistence', () => {
  const prisma = createTestPrismaClient();
  const prismaService = { getClient: async () => prisma };
  const memberships = new MembershipsService(
    prismaService,
    {
      getOrThrow: () => ({ nodeEnv: 'test' }),
    },
    new AuthorizationService(),
  );
  const organizations = new OrganizationsService(prismaService, new AuthorizationService());
  const sessionId = '10000000-0000-4000-8000-000000000010';

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_membership_audit ON "audit_logs"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_membership_audit()');
    await clearDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_membership_audit ON "audit_logs"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_membership_audit()');
    await prisma.$disconnect();
  });

  async function createUser(email) {
    return prisma.user.create({
      data: {
        email,
        normalizedEmail: email.toLowerCase(),
        passwordHash: 'integration-only-hash',
        firstName: 'Test',
        lastName: 'User',
      },
    });
  }

  function auth(user) {
    return { userId: user.id, sessionId, user, authenticatedAt: new Date() };
  }

  async function createOrganization(owner, slug) {
    return organizations.create(auth(owner), {
      legalName: `Organization ${slug}`,
      displayName: slug,
      slug,
      baseCurrency: 'INR',
      timezone: 'Asia/Kolkata',
    });
  }

  async function addMember(organizationId, user, role = 'MEMBER', status = 'ACTIVE') {
    return prisma.membership.create({
      data: {
        organizationId,
        userId: user.id,
        role,
        status,
        joinedAt: status === 'ACTIVE' ? new Date() : undefined,
        suspendedAt: status === 'SUSPENDED' ? new Date() : undefined,
      },
    });
  }

  it('normalizes email, stores only a token hash, and rejects duplicate pending invites', async () => {
    const owner = await createUser('owner@example.com');
    const organization = await createOrganization(owner, 'invite-storage');
    const invitation = await memberships.invite(auth(owner), organization.id, {
      email: ' Invitee@Example.com ',
      role: 'ACCOUNTANT',
    });
    const persisted = await prisma.organizationInvitation.findUnique({
      where: { id: invitation.id },
    });
    expect(persisted).toMatchObject({
      email: 'invitee@example.com',
      normalizedEmail: 'invitee@example.com',
      role: 'ACCOUNTANT',
      status: 'PENDING',
      tokenHash: hashInvitationToken(invitation.delivery.token),
    });
    expect(JSON.stringify(persisted)).not.toContain(invitation.delivery.token);
    await expect(
      memberships.invite(auth(owner), organization.id, {
        email: 'INVITEE@example.com',
        role: 'VIEWER',
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_INVITATION' });
    expect(
      await prisma.auditLog.count({ where: { action: 'ORGANIZATION_INVITATION_CREATED' } }),
    ).toBe(1);
  });

  it('accepts once for the bound email and atomically creates membership and audit', async () => {
    const owner = await createUser('owner-accept@example.com');
    const invitee = await createUser('invitee@example.com');
    const organization = await createOrganization(owner, 'accept-once');
    const invitation = await memberships.invite(auth(owner), organization.id, {
      email: 'Invitee@Example.com',
      role: 'VIEWER',
    });
    const accepted = await memberships.acceptInvitation(auth(invitee), invitation.delivery.token);
    expect(accepted).toMatchObject({
      organizationId: organization.id,
      role: 'VIEWER',
      status: 'ACTIVE',
    });
    expect(
      await prisma.organizationInvitation.findUnique({ where: { id: invitation.id } }),
    ).toMatchObject({ status: 'ACCEPTED', acceptedByUserId: invitee.id });
    expect(
      await prisma.auditLog.count({ where: { action: 'ORGANIZATION_INVITATION_ACCEPTED' } }),
    ).toBe(1);
    await expect(
      memberships.acceptInvitation(auth(invitee), invitation.delivery.token),
    ).rejects.toMatchObject({ code: 'INVITATION_INVALID_OR_EXPIRED' });
  });

  it('rejects the wrong email and persists expiry so an invitation cannot be reused', async () => {
    const owner = await createUser('owner-expiry@example.com');
    const invitee = await createUser('expiry@example.com');
    const other = await createUser('other@example.com');
    const organization = await createOrganization(owner, 'expiry-rules');
    const invitation = await memberships.invite(auth(owner), organization.id, {
      email: invitee.email,
      role: 'MEMBER',
    });
    await expect(
      memberships.acceptInvitation(auth(other), invitation.delivery.token),
    ).rejects.toMatchObject({ code: 'INVITATION_INVALID_OR_EXPIRED' });
    await prisma.organizationInvitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await expect(
      memberships.acceptInvitation(auth(invitee), invitation.delivery.token),
    ).rejects.toMatchObject({ code: 'INVITATION_INVALID_OR_EXPIRED' });
    expect(
      await prisma.organizationInvitation.findUnique({ where: { id: invitation.id } }),
    ).toMatchObject({ status: 'EXPIRED' });
    expect(await prisma.membership.count({ where: { userId: invitee.id } })).toBe(0);
  });

  it('changes role and enforces suspend, reactivate, remove, and durable reactivation', async () => {
    const owner = await createUser('owner-lifecycle@example.com');
    const user = await createUser('member-lifecycle@example.com');
    const organization = await createOrganization(owner, 'membership-lifecycle');
    const member = await addMember(organization.id, user);
    const changed = await memberships.changeRole(
      auth(owner),
      organization.id,
      member.id,
      1,
      'ACCOUNTANT',
    );
    const suspended = await memberships.suspend(auth(owner), organization.id, member.id, 2);
    const reactivated = await memberships.reactivate(auth(owner), organization.id, member.id, 3);
    await memberships.remove(auth(owner), organization.id, member.id, 4);
    const restored = await memberships.reactivate(auth(owner), organization.id, member.id, 5);
    expect(changed.role).toBe('ACCOUNTANT');
    expect(suspended.status).toBe('SUSPENDED');
    expect(reactivated.status).toBe('ACTIVE');
    expect(restored).toMatchObject({ id: member.id, status: 'ACTIVE', version: 6 });
    expect(
      await prisma.membership.count({
        where: { organizationId: organization.id, userId: user.id },
      }),
    ).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: 'Membership' } })).toBe(5);
  });

  it('protects Owner and scopes known membership IDs to the route organization', async () => {
    const ownerA = await createUser('owner-a-membership@example.com');
    const ownerB = await createUser('owner-b-membership@example.com');
    const userB = await createUser('member-b@example.com');
    const organizationA = await createOrganization(ownerA, 'membership-a');
    const organizationB = await createOrganization(ownerB, 'membership-b');
    const memberB = await addMember(organizationB.id, userB);
    await expect(
      memberships.remove(auth(ownerA), organizationA.id, organizationA.membership.id, 1),
    ).rejects.toMatchObject({ code: 'OWNER_TRANSFER_REQUIRED' });
    await expect(
      memberships.changeRole(auth(ownerA), organizationA.id, memberB.id, 1, 'VIEWER'),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(await prisma.membership.findUnique({ where: { id: memberB.id } })).toMatchObject({
      role: 'MEMBER',
      status: 'ACTIVE',
      version: 1,
    });
  });

  it('rolls back membership mutation when its required audit insert fails', async () => {
    const owner = await createUser('owner-rollback-member@example.com');
    const user = await createUser('rollback-member@example.com');
    const organization = await createOrganization(owner, 'membership-rollback');
    const member = await addMember(organization.id, user);
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_membership_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW."action" = 'MEMBERSHIP_ROLE_CHANGED' THEN
          RAISE EXCEPTION 'forced membership audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_membership_audit
      BEFORE INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION test_fail_membership_audit()
    `);
    await expect(
      memberships.changeRole(auth(owner), organization.id, member.id, 1, 'ADMIN'),
    ).rejects.toThrow();
    expect(await prisma.membership.findUnique({ where: { id: member.id } })).toMatchObject({
      role: 'MEMBER',
      version: 1,
    });
  });

  it('serializes competing ownership transfers and keeps exactly one active Owner', async () => {
    const owner = await createUser('owner-transfer@example.com');
    const first = await createUser('first-transfer@example.com');
    const second = await createUser('second-transfer@example.com');
    const organization = await createOrganization(owner, 'ownership-transfer');
    const firstMember = await addMember(organization.id, first, 'ADMIN');
    const secondMember = await addMember(organization.id, second, 'ACCOUNTANT');
    const outcomes = await Promise.allSettled([
      memberships.transferOwnership(auth(owner), organization.id, firstMember.id),
      memberships.transferOwnership(auth(owner), organization.id, secondMember.id),
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(
      await prisma.membership.count({
        where: { organizationId: organization.id, role: 'OWNER', status: 'ACTIVE' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: 'ORGANIZATION_OWNERSHIP_TRANSFERRED' } }),
    ).toBe(1);
  });
});
