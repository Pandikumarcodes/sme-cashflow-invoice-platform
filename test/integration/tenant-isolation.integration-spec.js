import { randomUUID } from 'node:crypto';
import { AuthorizationService } from '../../src/common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../src/common/authorization/permissions.js';
import { resolveTenantAccess } from '../../src/common/tenancy/tenant-context.js';
import {
  tenantWhere,
  tenantResourceWhere,
  requireTenantResource,
} from '../../src/database/helpers/tenant-query.js';
import { clearDatabase, createTestPrismaClient } from './database-test-helpers.js';

describe('tenant isolation with PostgreSQL', () => {
  const prisma = createTestPrismaClient();
  const authorization = new AuthorizationService();
  let auth;
  let organizationA;
  let membershipA;
  let membershipB;

  beforeEach(async () => {
    await clearDatabase(prisma);
    const user = await prisma.user.create({
      data: {
        email: 'tenant-owner@example.com',
        normalizedEmail: 'tenant-owner@example.com',
        passwordHash: 'integration-only-hash',
        firstName: 'Tenant',
        lastName: 'Owner',
      },
    });
    auth = { userId: user.id, sessionId: randomUUID() };
    organizationA = await prisma.organization.create({
      data: {
        legalName: 'Tenant A',
        displayName: 'Tenant A',
        baseCurrency: 'INR',
        timezone: 'Asia/Kolkata',
      },
    });
    const organizationB = await prisma.organization.create({
      data: {
        legalName: 'Tenant B',
        displayName: 'Tenant B',
        baseCurrency: 'INR',
        timezone: 'Asia/Kolkata',
      },
    });
    membershipA = await prisma.membership.create({
      data: {
        organizationId: organizationA.id,
        userId: user.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });
    membershipB = await prisma.membership.create({
      data: {
        organizationId: organizationB.id,
        userId: user.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => prisma.$disconnect());

  function resolve(client = prisma, identity = auth) {
    return resolveTenantAccess(client, identity, organizationA.id, authorization, [
      PERMISSIONS.MEMBERSHIP_READ,
    ]);
  }

  async function lookup(client, tenant, id) {
    return requireTenantResource(
      await client.membership.findFirst({
        where: tenantResourceWhere(tenant, id),
      }),
      'Membership',
    );
  }

  it('returns authoritative scope and conceals foreign and missing resources identically', async () => {
    const { tenant } = await resolve();
    expect(tenant).toMatchObject({
      organizationId: organizationA.id,
      membershipId: membershipA.id,
      role: 'OWNER',
      membershipStatus: 'ACTIVE',
    });
    expect(await lookup(prisma, tenant, membershipA.id)).toMatchObject({ id: membershipA.id });
    for (const id of [membershipB.id, randomUUID()]) {
      await expect(lookup(prisma, tenant, id)).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Membership not found.',
      });
    }
    // Even a broad OR and a conflicting tenant filter cannot escape scope.
    expect(
      await prisma.membership.findMany({
        where: tenantWhere(tenant, { OR: [{ id: membershipB.id }, { id: membershipA.id }] }),
      }),
    ).toHaveLength(1);
    expect(
      await prisma.membership.findMany({
        where: tenantWhere(tenant, { organizationId: membershipB.organizationId }),
      }),
    ).toEqual([]);
  });

  it('resolves current roles/status rather than trusting an earlier context', async () => {
    const { tenant: original } = await resolve();
    await prisma.membership.update({ where: { id: membershipA.id }, data: { role: 'ADMIN' } });
    expect((await resolve(prisma, original)).tenant.role).toBe('ADMIN');
    for (const status of ['SUSPENDED', 'REMOVED']) {
      await prisma.membership.update({ where: { id: membershipA.id }, data: { status } });
      await expect(resolve(prisma, original)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    }
  });

  it('uses the transaction client for resolution, resource queries and rollback', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.membership.update({ where: { id: membershipA.id }, data: { role: 'ADMIN' } });
        const { tenant } = await resolve(tx);
        expect(tenant.role).toBe('ADMIN');
        expect(await lookup(tx, tenant, membershipA.id)).toMatchObject({ role: 'ADMIN' });
        await expect(lookup(tx, tenant, membershipB.id)).rejects.toMatchObject({
          code: 'RESOURCE_NOT_FOUND',
        });
        const changed = await tx.membership.updateMany({
          where: { ...tenantResourceWhere(tenant, membershipA.id), version: 1 },
          data: { version: { increment: 1 } },
        });
        expect(changed.count).toBe(1);
        throw new Error('rollback tenant fixture');
      }),
    ).rejects.toThrow('rollback tenant fixture');
    expect(await prisma.membership.findUnique({ where: { id: membershipA.id } })).toMatchObject({
      role: 'OWNER',
      version: 1,
    });
  });
});
