import { randomUUID } from 'node:crypto';
import { AuthorizationService } from '../../src/common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../src/common/authorization/permissions.js';
import { resolveTenantAccess } from '../../src/common/tenancy/tenant-context.js';
import { CustomersService } from '../../src/modules/customers/application/customers.service.js';
import { clearDatabase, createTestPrismaClient } from './database-test-helpers.js';

describe('customer persistence and tenant isolation', () => {
  const prisma = createTestPrismaClient();
  const authorization = new AuthorizationService();
  const service = new CustomersService({ getClient: async () => prisma }, authorization);
  let tenantA;
  let tenantB;
  let membershipA;

  async function dropFailureTrigger() {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_customer_audit ON "audit_logs"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_customer_audit()');
  }

  beforeEach(async () => {
    await dropFailureTrigger();
    await clearDatabase(prisma);
    async function tenant(name) {
      const email = name + '@example.com';
      const user = await prisma.user.create({
        data: {
          email,
          normalizedEmail: email,
          passwordHash: 'integration-only-hash',
          firstName: name,
          lastName: 'Owner',
        },
      });
      const organization = await prisma.organization.create({
        data: {
          legalName: name,
          displayName: name,
          baseCurrency: 'INR',
          timezone: 'Asia/Kolkata',
        },
      });
      const membership = await prisma.membership.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });
      const { tenant: context } = await resolveTenantAccess(
        prisma,
        { userId: user.id, sessionId: randomUUID() },
        organization.id,
        authorization,
        [PERMISSIONS.CUSTOMER_CREATE],
      );
      return { context, membership };
    }
    const a = await tenant('tenant-a');
    tenantA = a.context;
    membershipA = a.membership;
    tenantB = (await tenant('tenant-b')).context;
  });

  afterEach(dropFailureTrigger);
  afterAll(async () => prisma.$disconnect());

  it('creates server-owned identity/lifecycle and audit; code uniqueness is tenant-wide', async () => {
    const input = { displayName: ' Acme ', customerCode: 'CODE', email: 'Contact@Example.com' };
    const created = await service.create(tenantA, input, { requestId: 'customer-create-test' });
    expect(created).toMatchObject({
      ...input,
      organizationId: tenantA.organizationId,
      createdByUserId: tenantA.userId,
      status: 'ACTIVE',
      version: 1,
    });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await prisma.auditLog.findFirst({ where: { entityId: created.id } })).toMatchObject({
      action: 'CUSTOMER_CREATED',
      actorUserId: tenantA.userId,
      actorMembershipId: tenantA.membershipId,
      actorSessionId: tenantA.sessionId,
      requestId: 'customer-create-test',
    });
    await expect(service.create(tenantA, input)).rejects.toMatchObject({
      code: 'CUSTOMER_CODE_UNAVAILABLE',
    });
    await expect(service.create(tenantB, input)).resolves.toMatchObject({ customerCode: 'CODE' });
    for (let i = 0; i < 2; i++) {
      await expect(
        service.create(tenantA, { displayName: input.displayName, email: input.email }),
      ).resolves.toMatchObject({ customerCode: null });
    }
    expect(await prisma.auditLog.count({ where: { action: 'CUSTOMER_CREATED' } })).toBe(4);
  });

  it('conceals foreign and missing detail/update/archive IDs and rejects forged context', async () => {
    const a = await service.create(tenantA, { displayName: 'A customer' });
    const b = await service.create(tenantB, { displayName: 'B customer' });
    expect((await service.list(tenantA)).data.map((row) => row.id)).toEqual([a.id]);
    for (const id of [b.id, randomUUID()]) {
      for (const call of [
        () => service.get(tenantA, id),
        () => service.update(tenantA, id, 1, { displayName: 'Attack' }),
        () => service.archive(tenantA, id),
      ]) {
        await expect(call()).rejects.toMatchObject({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Customer not found.',
        });
      }
    }
    await expect(service.get({ ...tenantA }, a.id)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(await prisma.customer.findUnique({ where: { id: b.id } })).toMatchObject({
      displayName: 'B customer',
      status: 'ACTIVE',
      version: 1,
    });
    expect(await prisma.auditLog.count()).toBe(2);
  });

  it('updates nullable fields with version checks and safely translates duplicate code conflicts', async () => {
    const a = await service.create(tenantA, {
      displayName: 'A',
      customerCode: 'A',
      email: 'a@example.com',
    });
    await service.create(tenantA, { displayName: 'B', customerCode: 'B' });
    await expect(service.update(tenantA, a.id, 1, { customerCode: 'B' })).rejects.toMatchObject({
      code: 'CUSTOMER_CODE_UNAVAILABLE',
    });
    expect(await prisma.customer.findUnique({ where: { id: a.id } })).toMatchObject({
      customerCode: 'A',
      version: 1,
    });
    const updated = await service.update(tenantA, a.id, 1, {
      customerCode: null,
      email: null,
      displayName: 'Corrected',
    });
    expect(updated).toMatchObject({
      customerCode: null,
      email: null,
      displayName: 'Corrected',
      version: 2,
    });
    await expect(service.update(tenantA, a.id, 1, { displayName: 'Stale' })).rejects.toMatchObject({
      code: 'CONCURRENT_MODIFICATION',
    });
    await expect(service.update(tenantA, a.id, 2, {})).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(await prisma.auditLog.count({ where: { action: 'CUSTOMER_UPDATED' } })).toBe(1);
  });

  it('archives idempotently, retains codes and historical readability, and permits safe correction', async () => {
    const a = await service.create(tenantA, { displayName: 'Historical', customerCode: 'OLD' });
    expect(await service.archive(tenantA, a.id)).toMatchObject({ status: 'ARCHIVED', version: 2 });
    expect(await service.archive(tenantA, a.id)).toMatchObject({ status: 'ARCHIVED', version: 2 });
    expect(await service.get(tenantA, a.id)).toMatchObject({ status: 'ARCHIVED' });
    expect((await service.list(tenantA)).data).toEqual([]);
    expect((await service.list(tenantA, { status: 'ARCHIVED' })).data).toHaveLength(1);
    expect(
      await service.update(tenantA, a.id, 2, { displayName: 'Corrected history' }),
    ).toMatchObject({ status: 'ARCHIVED', version: 3 });
    await expect(
      service.create(tenantA, { displayName: 'New', customerCode: 'OLD' }),
    ).rejects.toMatchObject({ code: 'CUSTOMER_CODE_UNAVAILABLE' });
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'CUSTOMER_ARCHIVED' } })).toBe(1);
  });

  it('commits only one optimistic update and one archive audit under concurrent requests', async () => {
    const a = await service.create(tenantA, { displayName: 'Race' });
    const results = await Promise.allSettled([
      service.update(tenantA, a.id, 1, { displayName: 'First' }),
      service.update(tenantA, a.id, 1, { displayName: 'Second' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason).toMatchObject({
      code: 'CONCURRENT_MODIFICATION',
    });
    const archives = await Promise.all([
      service.archive(tenantA, a.id),
      service.archive(tenantA, a.id),
    ]);
    expect(archives.every((row) => row.status === 'ARCHIVED' && row.version === 3)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'CUSTOMER_UPDATED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'CUSTOMER_ARCHIVED' } })).toBe(1);
  });

  it('rolls back create, update and archive when their mandatory audit fails', async () => {
    const a = await service.create(tenantA, { displayName: 'Before' });
    await prisma.$executeRawUnsafe(`CREATE FUNCTION test_fail_customer_audit() RETURNS trigger AS $$
      BEGIN IF NEW."entityType" = 'Customer' THEN RAISE EXCEPTION 'forced customer audit failure'; END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER test_fail_customer_audit BEFORE INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION test_fail_customer_audit()`);
    await expect(service.create(tenantA, { displayName: 'Rolled back' })).rejects.toThrow();
    await expect(
      service.update(tenantA, a.id, 1, { displayName: 'Rolled back' }),
    ).rejects.toThrow();
    await expect(service.archive(tenantA, a.id)).rejects.toThrow();
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.customer.findUnique({ where: { id: a.id } })).toMatchObject({
      displayName: 'Before',
      status: 'ACTIVE',
      version: 1,
    });
    expect(await prisma.auditLog.count()).toBe(1);
  });

  it('re-checks current role and membership status instead of trusting the supplied snapshot', async () => {
    const a = await service.create(tenantA, { displayName: 'Role state' });
    await prisma.membership.update({ where: { id: membershipA.id }, data: { role: 'VIEWER' } });
    await expect(service.get(tenantA, a.id)).resolves.toBeDefined();
    await expect(service.create(tenantA, { displayName: 'Denied' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    for (const status of ['SUSPENDED', 'REMOVED']) {
      await prisma.membership.update({ where: { id: membershipA.id }, data: { status } });
      await expect(service.get(tenantA, a.id)).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
      });
    }
    await prisma.membership.update({
      where: { id: membershipA.id },
      data: { role: 'MEMBER', status: 'ACTIVE' },
    });
    await expect(service.create(tenantA, { displayName: 'Restored' })).resolves.toBeDefined();
  });

  it('paginates tied sort keys consistently in both directions and binds cursors to filters and tenant', async () => {
    for (let i = 0; i < 5; i++) {
      await service.create(tenantA, { displayName: i < 3 ? 'Same' : 'Zulu' });
    }
    await prisma.customer.updateMany({
      where: { organizationId: tenantA.organizationId },
      data: {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    for (const sortBy of ['displayName', 'createdAt', 'updatedAt']) {
      for (const sortOrder of ['asc', 'desc']) {
        const query = { limit: '2', sortBy, sortOrder };
        const seen = [];
        let after;
        do {
          const page = await service.list(tenantA, { ...query, ...(after ? { after } : {}) });
          seen.push(...page.data.map((row) => row.id));
          after = page.meta.nextCursor;
          expect(page.meta.hasMore).toBe(Boolean(after));
        } while (after);
        const expected = await prisma.customer.findMany({
          where: { organizationId: tenantA.organizationId },
          orderBy: [{ [sortBy]: sortOrder }, { id: sortOrder }],
        });
        expect(seen).toEqual(expected.map((row) => row.id));
        expect(new Set(seen).size).toBe(5);
      }
    }
    const first = await service.list(tenantA, { limit: '1' });
    await expect(service.list(tenantB, { after: first.meta.nextCursor })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
    await expect(
      service.list(tenantA, { after: first.meta.nextCursor, status: 'ARCHIVED' }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    // The seek cursor does not rely on its anchor still satisfying the query.
    await service.archive(tenantA, first.data[0].id);
    expect((await service.list(tenantA, { after: first.meta.nextCursor })).data).toHaveLength(4);
  });

  it('searches display names and email case-insensitively with literal LIKE metacharacters', async () => {
    const literal = await service.create(tenantA, {
      displayName: 'Acme %_\\ customer',
      email: 'Contact@Example.com',
    });
    await service.create(tenantA, { displayName: 'Acme plain customer' });
    await service.create(tenantB, { displayName: literal.displayName, email: literal.email });
    for (const search of ['%_', 'CONTACT@', '_\\']) {
      expect((await service.list(tenantA, { search })).data.map((row) => row.id)).toEqual([
        literal.id,
      ]);
    }
  });
});
