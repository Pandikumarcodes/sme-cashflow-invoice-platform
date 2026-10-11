import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { clearDatabase, createTestPrismaClient } from './integration/database-test-helpers.js';

jest.setTimeout(30000);
describe('audit list HTTP contract', () => {
  const prisma = createTestPrismaClient();
  let app, server, owner, org, base;
  const auth = (user = owner) => ({ Authorization: `Bearer ${user.token}` });
  async function identity(email) {
    const password = 'correct horse battery staple';
    await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Audit', lastName: 'Reader' })
      .expect(201);
    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return { token: response.body.data.accessToken, userId: response.body.data.user.id };
  }
  async function organization(user, slug) {
    return (
      await request(server)
        .post('/api/v1/organizations')
        .set(auth(user))
        .send({ legalName: slug, slug, baseCurrency: 'INR', timezone: 'Asia/Kolkata' })
        .expect(201)
    ).body.data;
  }
  const list = (query = {}) => request(server).get(base).set(auth()).query(query);
  const seed = (data = {}) =>
    prisma.auditLog.create({
      data: {
        organizationId: org.id,
        actorType: 'WORKER',
        source: 'WORKER',
        action: 'historical.action',
        entityType: 'Customer',
        entityId: randomUUID(),
        occurredAt: new Date('2026-01-01'),
        ...data,
      },
    });
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer();
  });
  beforeEach(async () => {
    await clearDatabase(prisma);
    owner = await identity('audit-owner@example.com');
    org = await organization(owner, 'audit-http');
    base = `/api/v1/organizations/${org.id}/audit-logs`;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  it('returns real immutable writer history in the collection envelope and exposes no mutation/detail APIs', async () => {
    const customer = (
      await request(server)
        .post(`/api/v1/organizations/${org.id}/customers`)
        .set(auth())
        .send({ displayName: 'Buyer' })
        .expect(201)
    ).body.data;
    const before = await prisma.auditLog.count();
    const result = (
      await list({
        entityType: 'Customer',
        entityId: customer.id,
        actorUserId: owner.userId,
      }).expect(200)
    ).body;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      action: 'CUSTOMER_CREATED',
      actorUserId: owner.userId,
      entityId: customer.id,
      afterData: { displayName: 'Buyer' },
    });
    expect(result.meta).toEqual({ limit: 25, hasMore: false, nextCursor: null });
    expect(await prisma.auditLog.count()).toBe(before);
    await request(server)
      .get(base + '/' + result.data[0].id)
      .set(auth())
      .expect(404);
    await request(server).post(base).set(auth()).send({}).expect(404);
    await request(server)
      .patch(base + '/' + result.data[0].id)
      .set(auth())
      .send({ action: 'CHANGE' })
      .expect(404);
    await request(server)
      .delete(base + '/' + result.data[0].id)
      .set(auth())
      .expect(404);
  });
  it('paginates tied timestamps and filters audit instants with safe nullable worker metadata', async () => {
    const rows = [await seed(), await seed(), await seed()];
    await seed({ occurredAt: new Date('2026-01-01T18:30:00Z') });
    const query = {
      action: 'historical.action',
      occurredFrom: '2026-01-01',
      occurredTo: '2026-01-01',
      limit: '1',
    };
    const first = (await list(query).expect(200)).body;
    const second = (await list({ ...query, after: first.meta.nextCursor }).expect(200)).body;
    const third = (await list({ ...query, after: second.meta.nextCursor }).expect(200)).body;
    expect([first.data[0].id, second.data[0].id, third.data[0].id]).toEqual(
      rows
        .map((r) => r.id)
        .sort()
        .reverse(),
    );
    expect(first.data[0]).toMatchObject({
      actorType: 'WORKER',
      actorUserId: null,
      actorMembershipId: null,
    });
    expect(third.meta).toMatchObject({ hasMore: false, nextCursor: null });
    const row = await seed({
      afterData: { status: 'ARCHIVED', refreshToken: 'sensitive-test' },
      metadata: { stack: 'sensitive-test' },
    });
    const response = (await list({ entityId: row.entityId }).expect(200)).body;
    expect(response.data[0]).toMatchObject({ afterData: { status: 'ARCHIVED' }, metadata: null });
    expect(JSON.stringify(response)).not.toContain('sensitive-test');
  });
  it('rejects unknown, repeated and invalid inputs with canonical safe errors and returns empty pages', async () => {
    for (const query of [
      { limit: '0' },
      { limit: '101' },
      { actorUserId: 'no' },
      { entityId: 'no' },
      { requestId: randomUUID() },
      { sortBy: 'action' },
      { sortOrder: 'wrong' },
      { action: ['A', 'B'] },
      { occurredFrom: '2026-02-30' },
      { occurredFrom: '2026-02-01', occurredTo: '2026-01-01' },
      { after: 'garbage' },
    ]) {
      const result = (await list(query).expect(400)).body;
      expect(result.error.code).toMatch(/VALIDATION_ERROR|INVALID_REQUEST|INVALID_CURSOR/);
      expect(result.error.requestId).toBeDefined();
      expect(JSON.stringify(result)).not.toMatch(/Prisma|SELECT|stack|constraint/);
    }
    expect((await list({ action: 'absent' }).expect(200)).body).toMatchObject({
      data: [],
      meta: { nextCursor: null, hasMore: false },
    });
  });
  it('enforces current roles and conceals nonmembers and inactive membership under existing JWTs', async () => {
    await request(server).get(base).expect(401);
    const user = await identity('audit-member@example.com');
    await request(server).get(base).set(auth(user)).expect(404);
    const membership = await prisma.membership.create({
      data: { organizationId: org.id, userId: user.userId, role: 'ACCOUNTANT', status: 'ACTIVE' },
    });
    for (const role of ['ACCOUNTANT', 'ADMIN', 'MEMBER', 'VIEWER']) {
      await prisma.membership.update({ where: { id: membership.id }, data: { role } });
      await request(server)
        .get(base)
        .set(auth(user))
        .expect(['ACCOUNTANT', 'ADMIN'].includes(role) ? 200 : 403);
    }
    await prisma.membership.update({
      where: { id: membership.id },
      data: { role: 'ADMIN', status: 'SUSPENDED' },
    });
    await request(server).get(base).set(auth(user)).expect(404);
    await prisma.membership.update({ where: { id: membership.id }, data: { status: 'REMOVED' } });
    await request(server).get(base).set(auth(user)).expect(404);
  });
  it('fences tenant B rows and cursor reuse even for a user authorized in both organizations', async () => {
    const other = await organization(owner, 'audit-other');
    const row = await seed({ organizationId: other.id });
    expect((await list({ entityId: row.entityId }).expect(200)).body.data).toEqual([]);
    await seed();
    await seed();
    const cursor = (await list({ action: 'historical.action', limit: '1' }).expect(200)).body.meta
      .nextCursor;
    const response = await request(server)
      .get(`/api/v1/organizations/${other.id}/audit-logs`)
      .set(auth())
      .query({ action: 'historical.action', after: cursor })
      .expect(400);
    expect(response.body.error.code).toBe('INVALID_CURSOR');
    await list({ action: 'different', after: cursor }).expect(400);
  });
});
