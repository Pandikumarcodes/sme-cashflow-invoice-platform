import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { clearDatabase, createTestPrismaClient } from './integration/database-test-helpers.js';

jest.setTimeout(30_000);
const password = 'correct horse battery staple';

describe('customer endpoints (e2e)', () => {
  const prisma = createTestPrismaClient();
  let app;
  let server;
  let owner;
  let organization;
  let base;

  async function login(email) {
    await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Test', lastName: 'User' })
      .expect(201);
    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return { token: response.body.data.accessToken, userId: response.body.data.user.id };
  }

  const auth = (identity) => ({ Authorization: `Bearer ${identity.token}` });

  async function createOrganization(identity, slug) {
    const response = await request(server)
      .post('/api/v1/organizations')
      .set(auth(identity))
      .send({
        legalName: slug,
        displayName: slug,
        slug,
        baseCurrency: 'INR',
        timezone: 'Asia/Kolkata',
      })
      .expect(201);
    return response.body.data;
  }

  async function createCustomer(input = { displayName: 'Acme' }) {
    return request(server).post(base).set(auth(owner)).send(input).expect(201);
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await clearDatabase(prisma);
    owner = await login('customer-owner@example.com');
    organization = await createOrganization(owner, 'customer-tenant');
    base = `/api/v1/organizations/${organization.id}/customers`;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('creates, reads, updates and archives customers with ETags and retained history', async () => {
    const created = await createCustomer({
      displayName: 'Acme',
      email: 'Contact@Example.com',
      customerCode: 'ACME',
    });
    const id = created.body.data.id;
    expect(created.headers.etag).toBe('"1"');
    expect(created.body.data).toMatchObject({
      organizationId: organization.id,
      createdByUserId: owner.userId,
      status: 'ACTIVE',
      version: 1,
      email: 'Contact@Example.com',
      customerCode: 'ACME',
    });
    expect(created.body.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const detail = await request(server)
      .get(base + '/' + id)
      .set(auth(owner))
      .expect(200);
    expect(detail.body.data).toEqual(created.body.data);
    const list = await request(server).get(base).set(auth(owner)).expect(200);
    expect(list.body).toMatchObject({
      data: [created.body.data],
      meta: { limit: 25, nextCursor: null, hasMore: false },
    });
    const updated = await request(server)
      .patch(base + '/' + id)
      .set(auth(owner))
      .set('If-Match', '"1"')
      .send({ displayName: 'Corrected', email: null })
      .expect(200);
    expect(updated.headers.etag).toBe('"2"');
    expect(updated.body.data).toMatchObject({ displayName: 'Corrected', email: null, version: 2 });
    const stale = await request(server)
      .patch(base + '/' + id)
      .set(auth(owner))
      .set('If-Match', '"1"')
      .send({ displayName: 'Stale' })
      .expect(409);
    expect(stale.body.error.code).toBe('CONCURRENT_MODIFICATION');
    const archived = await request(server)
      .post(base + '/' + id + '/archive')
      .set(auth(owner))
      .send({})
      .expect(200);
    expect(archived.body.data).toMatchObject({ status: 'ARCHIVED', version: 3 });
    const repeated = await request(server)
      .post(base + '/' + id + '/archive')
      .set(auth(owner))
      .send({})
      .expect(200);
    expect(repeated.body.data).toEqual(archived.body.data);
    expect((await request(server).get(base).set(auth(owner)).expect(200)).body.data).toEqual([]);
    expect(
      (await request(server).get(base).query({ status: 'ARCHIVED' }).set(auth(owner)).expect(200))
        .body.data,
    ).toHaveLength(1);
    await request(server)
      .get(base + '/' + id)
      .set(auth(owner))
      .expect(200);
    await request(server)
      .patch(base + '/' + id)
      .set(auth(owner))
      .set('If-Match', '"3"')
      .send({ customerCode: null })
      .expect(200);
    await request(server)
      .delete(base + '/' + id)
      .set(auth(owner))
      .expect(404);
    expect(await prisma.customer.count({ where: { id } })).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: 'CUSTOMER_ARCHIVED', entityId: id } }),
    ).toBe(1);
  });

  it('rejects invalid input, immutable fields, unsupported schema fields and malformed UUIDs/headers', async () => {
    for (const input of [
      {},
      { displayName: null },
      { displayName: '   ' },
      { displayName: 'x'.repeat(201) },
      { displayName: 'Acme', customerCode: '' },
      { displayName: 'Acme', customerCode: 'x'.repeat(51) },
      { displayName: 'Acme', email: 'invalid' },
      { displayName: 'Acme', email: [] },
      { displayName: 'Acme', organizationId: randomUUID() },
      { displayName: 'Acme', status: 'ARCHIVED' },
      { displayName: 'Acme', createdByUserId: owner.userId },
      { displayName: 'Acme', id: randomUUID() },
      { displayName: 'Acme', version: 50 },
      { displayName: 'Acme', createdAt: new Date().toISOString() },
      { displayName: 'Acme', phone: '1234' },
      { displayName: 'Acme', customerType: 'BUSINESS' },
    ]) {
      await request(server).post(base).set(auth(owner)).send(input).expect(400);
    }
    const customer = await createCustomer();
    const path = base + '/' + customer.body.data.id;
    for (const ifMatch of [undefined, '0', '-1', '1.5', '2147483648', '"1', '1"', 'NaN']) {
      const call = request(server).patch(path).set(auth(owner));
      if (ifMatch !== undefined) call.set('If-Match', ifMatch);
      await call.send({ displayName: 'Changed' }).expect(400);
    }
    for (const input of [
      {},
      { displayName: null },
      { organizationId: randomUUID() },
      { status: 'ARCHIVED' },
    ]) {
      await request(server)
        .patch(path)
        .set(auth(owner))
        .set('If-Match', '"1"')
        .send(input)
        .expect(400);
    }
    await request(server)
      .post(path + '/archive')
      .set(auth(owner))
      .send({ status: 'ARCHIVED' })
      .expect(400);
    await request(server)
      .get(base + '/not-a-uuid')
      .set(auth(owner))
      .expect(400);
    await request(server)
      .get('/api/v1/organizations/not-a-uuid/customers')
      .set(auth(owner))
      .expect(400);
    expect(await prisma.customer.count()).toBe(1);
    expect(
      await prisma.customer.findUnique({ where: { id: customer.body.data.id } }),
    ).toMatchObject({ version: 1, status: 'ACTIVE' });
  });

  it('returns safe code-conflict errors while permitting duplicate names and emails', async () => {
    const input = { displayName: 'Acme', customerCode: 'CODE', email: 'same@example.com' };
    await createCustomer(input);
    const duplicate = await request(server).post(base).set(auth(owner)).send(input).expect(409);
    expect(duplicate.body.error).toMatchObject({
      code: 'CUSTOMER_CODE_UNAVAILABLE',
      message: 'Customer code is unavailable.',
    });
    expect(JSON.stringify(duplicate.body)).not.toMatch(/Prisma|P2002|SQL|constraint|stack/);
    await createCustomer({ displayName: input.displayName, email: input.email });
    const second = await createCustomer({ displayName: 'Other', customerCode: 'OTHER' });
    const conflict = await request(server)
      .patch(base + '/' + second.body.data.id)
      .set(auth(owner))
      .set('If-Match', '"1"')
      .send({ customerCode: 'CODE' })
      .expect(409);
    expect(conflict.body.error.code).toBe('CUSTOMER_CODE_UNAVAILABLE');
    expect(await prisma.customer.findUnique({ where: { id: second.body.data.id } })).toMatchObject({
      customerCode: 'OTHER',
      version: 1,
    });
  });

  it('paginates and searches with bounded query validation and cursor filter binding', async () => {
    for (const name of ['Alpha', 'Alpha', 'Zulu']) await createCustomer({ displayName: name });
    const first = await request(server)
      .get(base)
      .set(auth(owner))
      .query({ limit: '1', search: 'ALPHA' })
      .expect(200);
    expect(first.body.meta).toMatchObject({ limit: 1, hasMore: true });
    const second = await request(server)
      .get(base)
      .set(auth(owner))
      .query({ limit: '1', search: 'ALPHA', after: first.body.meta.nextCursor })
      .expect(200);
    expect(second.body.meta).toMatchObject({ hasMore: false, nextCursor: null });
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
    const changed = await request(server)
      .get(base)
      .set(auth(owner))
      .query({ after: first.body.meta.nextCursor, search: 'Zulu' })
      .expect(400);
    expect(changed.body.error.code).toBe('INVALID_CURSOR');
    for (const query of [
      { limit: '0' },
      { limit: '101' },
      { limit: '1.5' },
      { limit: '-1' },
      { limit: '1e2' },
      { status: 'DELETED' },
      { search: 'a' },
      { search: 'x'.repeat(101) },
      { sortBy: 'email' },
      { sortOrder: 'invalid' },
      { customerType: 'BUSINESS' },
      { organizationId: randomUUID() },
      { after: 'e30' },
      { after: 'x'.repeat(2049) },
      { limit: ['1', '2'] },
    ]) {
      await request(server).get(base).set(auth(owner)).query(query).expect(400);
    }
    const descending = await request(server)
      .get(base)
      .set(auth(owner))
      .query({ limit: '100', sortOrder: 'desc' })
      .expect(200);
    expect(descending.body.data[0].displayName).toBe('Zulu');
  });

  it('conceals tenant/resource boundaries equally for read, update and archive', async () => {
    const other = await login('other-owner@example.com');
    const orgB = await createOrganization(other, 'other-tenant');
    const baseB = `/api/v1/organizations/${orgB.id}/customers`;
    const a = await createCustomer({ displayName: 'A customer' });
    const b = await request(server)
      .post(baseB)
      .set(auth(other))
      .send({ displayName: 'B customer' })
      .expect(201);
    await request(server).get(base).expect(401);
    await request(server).post(base).send({ displayName: 'Anonymous' }).expect(401);
    await request(server).get(baseB).set(auth(owner)).expect(404);
    await request(server).post(baseB).set(auth(owner)).send({ displayName: 'Attack' }).expect(404);
    const own = await request(server)
      .get(base + '/' + a.body.data.id)
      .set(auth(owner))
      .set('X-Organization-Id', orgB.id)
      .expect(200);
    expect(own.body.data.organizationId).toBe(organization.id);
    expect(
      (await request(server).get(base).set(auth(owner)).expect(200)).body.data.map((row) => row.id),
    ).toEqual([a.body.data.id]);
    const errors = [];
    for (const id of [b.body.data.id, randomUUID()]) {
      const detail = await request(server)
        .get(base + '/' + id)
        .set(auth(owner))
        .expect(404);
      errors.push({ code: detail.body.error.code, message: detail.body.error.message });
      await request(server)
        .patch(base + '/' + id)
        .set(auth(owner))
        .set('If-Match', '"1"')
        .send({ displayName: 'Attack' })
        .expect(404);
      await request(server)
        .post(base + '/' + id + '/archive')
        .set(auth(owner))
        .send({})
        .expect(404);
    }
    expect(errors[0]).toEqual(errors[1]);
    expect(await prisma.customer.findUnique({ where: { id: b.body.data.id } })).toMatchObject({
      displayName: 'B customer',
      version: 1,
      status: 'ACTIVE',
    });
  });

  it('enforces current RBAC and suspension/removal with the same JWT', async () => {
    const member = await login('customer-member@example.com');
    const membership = await prisma.membership.create({
      data: {
        organizationId: organization.id,
        userId: member.userId,
        role: 'VIEWER',
        status: 'ACTIVE',
      },
    });
    const a = await createCustomer();
    const path = base + '/' + a.body.data.id;
    await request(server).get(base).set(auth(member)).expect(200);
    await request(server).get(path).set(auth(member)).expect(200);
    await request(server).post(base).set(auth(member)).send({ displayName: 'Denied' }).expect(403);
    await request(server)
      .patch(path)
      .set(auth(member))
      .set('If-Match', '"1"')
      .send({ displayName: 'Denied' })
      .expect(403);
    await request(server)
      .post(path + '/archive')
      .set(auth(member))
      .send({})
      .expect(403);
    for (const role of ['MEMBER', 'ACCOUNTANT', 'ADMIN']) {
      await prisma.membership.update({ where: { id: membership.id }, data: { role } });
      const created = await request(server)
        .post(base)
        .set(auth(member))
        .send({ displayName: role })
        .expect(201);
      await request(server)
        .patch(base + '/' + created.body.data.id)
        .set(auth(member))
        .set('If-Match', '"1"')
        .send({ displayName: role + ' corrected' })
        .expect(200);
      await request(server)
        .post(base + '/' + created.body.data.id + '/archive')
        .set(auth(member))
        .send({})
        .expect(200);
    }
    for (const status of ['SUSPENDED', 'REMOVED']) {
      await prisma.membership.update({ where: { id: membership.id }, data: { status } });
      await request(server).get(base).set(auth(member)).expect(404);
      await request(server).get(path).set(auth(member)).expect(404);
      await request(server)
        .post(base)
        .set(auth(member))
        .send({ displayName: 'Inactive' })
        .expect(404);
    }
    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'ACTIVE', role: 'VIEWER' },
    });
    await request(server).get(path).set(auth(member)).expect(200);
    await prisma.organization.update({
      where: { id: organization.id },
      data: { status: 'CLOSED' },
    });
    await request(server).get(path).set(auth(member)).expect(404);
  });
});
