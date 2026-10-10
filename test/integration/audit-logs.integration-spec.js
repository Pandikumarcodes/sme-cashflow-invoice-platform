import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { AuditLogsService } from '../../src/modules/audit-logs/application/audit-logs.service.js';
import { clearDatabase, createTestPrismaClient } from './database-test-helpers.js';
import { notificationFixture } from '../helpers/notification-fixture.js';

jest.setTimeout(30000);
describe('audit history PostgreSQL reads', () => {
  const prisma = createTestPrismaClient();
  let a, b, service;
  beforeEach(async () => {
    await clearDatabase(prisma);
    a = await notificationFixture(prisma, 'audit-a');
    b = await notificationFixture(prisma, 'audit-b');
    service = new AuditLogsService(a.provider, a.authorization);
  });
  afterAll(async () => prisma.$disconnect());
  const seed = (fixture = a, data = {}) =>
    prisma.auditLog.create({
      data: {
        organizationId: fixture.org.id,
        actorType: 'SYSTEM',
        source: 'SYSTEM',
        action: 'HISTORICAL',
        entityType: 'Customer',
        entityId: randomUUID(),
        occurredAt: new Date('2026-01-01'),
        ...data,
      },
    });
  const list = (query = {}, fixture = a) => service.list(fixture.tenant, query);
  it('reads actual organization/customer/invoice/payment writer evidence without mutating any rows', async () => {
    await a.payments.record(
      a.tenant,
      a.invoice.id,
      { amount: '0.30', paymentDate: '2026-01-31', method: 'BANK_TRANSFER' },
      randomUUID(),
    );
    const before = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
    const result = await list();
    expect(result.data).toHaveLength(5);
    expect(result.data.every((row) => row.organizationId === a.org.id)).toBe(true);
    expect(
      result.data.find((row) => row.action === 'PAYMENT_RECORDED').afterData.payment.amount,
    ).toBe('0.30');
    expect(
      result.data.find((row) => row.action === 'INVOICE_ISSUED').afterData.items[0].quantity,
    ).toBe('1');
    expect(await prisma.auditLog.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });
  it('paginates timestamp ties in both directions and fences cross-tenant cursors/filters/global events', async () => {
    const rows = [await seed(), await seed(), await seed()];
    await seed(b);
    await seed(a, { organizationId: null });
    for (const sortOrder of ['asc', 'desc']) {
      const ids = [];
      let after;
      do {
        const page = await list({
          action: 'HISTORICAL',
          sortOrder,
          limit: '1',
          ...(after ? { after } : {}),
        });
        ids.push(...page.data.map((row) => row.id));
        after = page.meta.nextCursor;
      } while (after);
      expect(ids).toEqual(
        rows
          .map((r) => r.id)
          .sort()
          .slice()
          [sortOrder === 'desc' ? 'reverse' : 'slice'](),
      );
    }
    expect((await list({ entityId: (await seed(b)).entityId })).data).toEqual([]);
    const cursor = (await list({ action: 'HISTORICAL', limit: '1' })).meta.nextCursor;
    await expect(list({ action: 'HISTORICAL', after: cursor }, b)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
    await expect(service.list({ ...a.tenant })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });
  it('filters exact actors/actions/entities and local-day instant boundaries without resolving historical resources', async () => {
    const id = randomUUID();
    const row = await seed(a, {
      entityId: id,
      actorType: 'USER',
      actorUserId: a.user.id,
      occurredAt: new Date('2025-12-31T18:30:00Z'),
    });
    await seed(a, { entityId: id, occurredAt: new Date('2026-01-01T18:30:00Z') });
    await seed(a, { entityId: id, occurredAt: new Date('2025-12-31T18:29:59.999Z') });
    expect(
      (
        await list({
          action: 'HISTORICAL',
          entityType: 'Customer',
          entityId: id,
          actorUserId: a.user.id,
          occurredFrom: '2026-01-01',
          occurredTo: '2026-01-01',
        })
      ).data.map((r) => r.id),
    ).toEqual([row.id]);
    expect(
      (await list({ entityId: id, occurredFrom: '2026-01-01', occurredTo: '2026-01-01' })).data,
    ).toHaveLength(1);
    expect((await list({ actorUserId: b.user.id })).data).toEqual([]);
    expect((await list({ action: 'does-not-exist' })).meta).toEqual({
      limit: 25,
      hasMore: false,
      nextCursor: null,
    });
  });
  it('preserves system actors and archived customer history, redacts unsafe JSON without altering storage', async () => {
    await prisma.customer.update({
      where: { id: a.customer.id },
      data: { status: 'ARCHIVED' },
    });
    const row = await seed(a, {
      entityId: a.customer.id,
      afterData: {
        status: 'ARCHIVED',
        passwordHash: 'sensitive-test',
        email: { token: 'sensitive-test' },
      },
      metadata: { stack: 'sensitive-test' },
    });
    const response = (await list({ action: 'HISTORICAL', entityId: a.customer.id })).data[0];
    expect(response).toMatchObject({
      id: row.id,
      actorType: 'SYSTEM',
      actorUserId: null,
      afterData: { status: 'ARCHIVED', email: null },
      metadata: null,
    });
    expect(JSON.stringify(response)).not.toContain('sensitive-test');
    expect(await prisma.auditLog.findUnique({ where: { id: row.id } })).toEqual(row);
  });
  it('retains database append-only update/delete protection after reads', async () => {
    const row = await seed();
    await list();
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'REWRITTEN' } }),
    ).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    expect(await prisma.auditLog.findUnique({ where: { id: row.id } })).toEqual(row);
  });
  it('rechecks current membership and permission in the read transaction', async () => {
    await prisma.membership.update({
      where: { id: a.tenant.membershipId },
      data: { role: 'VIEWER' },
    });
    await expect(list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await prisma.membership.update({
      where: { id: a.tenant.membershipId },
      data: { status: 'SUSPENDED' },
    });
    await expect(list()).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
