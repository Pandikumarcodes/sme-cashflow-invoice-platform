import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { clearDatabase, createTestPrismaClient } from './integration/database-test-helpers.js';

jest.setTimeout(30000);
describe('invoice HTTP workflows', () => {
  const prisma = createTestPrismaClient();
  const password = 'correct horse battery staple';
  let app;
  let server;
  let owner;
  let organization;
  let customer;
  let base;
  const auth = (identity = owner) => ({ Authorization: `Bearer ${identity.token}` });
  async function login(email) {
    await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Invoice', lastName: 'User' })
      .expect(201);
    const result = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return { token: result.body.data.accessToken, userId: result.body.data.user.id };
  }
  async function createOrganization(identity, slug) {
    return (
      await request(server)
        .post('/api/v1/organizations')
        .set(auth(identity))
        .send({ legalName: slug, slug, baseCurrency: 'INR', timezone: 'Asia/Kolkata' })
        .expect(201)
    ).body.data;
  }
  const input = (overrides = {}) => ({
    customerId: customer.id,
    issueDate: '2026-01-01',
    dueDate: '2026-01-31',
    discount: { type: 'NONE', value: '0' },
    taxRate: '18',
    items: [{ description: 'Service', quantity: '3', unitPrice: '33.335', sortOrder: 0 }],
    ...overrides,
  });
  const create = (overrides) =>
    request(server).post(base).set(auth()).send(input(overrides)).expect(201);
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer();
  });
  beforeEach(async () => {
    await clearDatabase(prisma);
    owner = await login('invoice-owner@example.com');
    organization = await createOrganization(owner, 'invoice-tenant');
    customer = (
      await request(server)
        .post(`/api/v1/organizations/${organization.id}/customers`)
        .set(auth())
        .send({ displayName: 'Acme Customer', email: 'acme@example.com' })
        .expect(201)
    ).body.data;
    base = `/api/v1/organizations/${organization.id}/invoices`;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('creates, lists/searches/filters, gets, updates and issues exact server totals with ETags', async () => {
    const created = await create();
    const id = created.body.data.id;
    expect(created.headers.etag).toBe('"1"');
    expect(created.body.data).toMatchObject({
      status: 'DRAFT',
      invoiceNumber: null,
      total: '118.01',
      amountPaid: '0.00',
      balanceDue: '118.01',
      currency: 'INR',
    });
    expect(created.body.data.items[0]).toMatchObject({
      quantity: '3',
      unitPrice: '33.3350',
      lineAmount: '100.01',
    });
    expect((await request(server).get(base).set(auth()).expect(200)).body).toMatchObject({
      data: [created.body.data],
      meta: { limit: 25, hasMore: false },
    });
    expect(
      (
        await request(server)
          .get(base)
          .set(auth())
          .query({ search: 'ACME', status: 'DRAFT', customerId: customer.id })
          .expect(200)
      ).body.data,
    ).toHaveLength(1);
    expect(
      (
        await request(server)
          .get(base + '/' + id)
          .set(auth())
          .expect(200)
      ).body.data,
    ).toEqual(created.body.data);
    const updated = await request(server)
      .patch(base + '/' + id)
      .set(auth())
      .set('If-Match', '"1"')
      .send({ discount: { type: 'PERCENTAGE', value: '10' } })
      .expect(200);
    expect(updated.body.data.total).toBe('106.21');
    expect(updated.headers.etag).toBe('"2"');
    const stale = await request(server)
      .patch(base + '/' + id)
      .set(auth())
      .set('If-Match', '"1"')
      .send({ taxRate: '0' })
      .expect(409);
    expect(stale.body.error.code).toBe('CONCURRENT_MODIFICATION');
    await request(server)
      .post(base + '/' + id + '/issue')
      .set(auth())
      .set('If-Match', '1')
      .send({})
      .expect(409);
    const issued = await request(server)
      .post(base + '/' + id + '/issue')
      .set(auth())
      .set('If-Match', '"2"')
      .send({})
      .expect(200);
    expect(issued.headers.etag).toBe('"3"');
    expect(issued.body.data).toMatchObject({
      status: 'ISSUED',
      invoiceNumber: 'INV-000001',
      sequenceValue: '1',
      paymentState: 'UNPAID',
      isOverdue: true,
      total: '106.21',
    });
    expect(issued.body.data.issuedAt).toMatch(/^\d{4}-/);
    expect(
      (
        await request(server)
          .get(base)
          .set(auth())
          .query({
            paymentState: 'UNPAID',
            overdue: 'true',
            search: 'INV-000001',
            issueDateFrom: '2026-01-01',
            issueDateTo: '2026-01-02',
          })
          .expect(200)
      ).body.data,
    ).toHaveLength(1);
    const finalized = await request(server)
      .patch(base + '/' + id)
      .set(auth())
      .set('If-Match', '3')
      .send({ taxRate: '0' })
      .expect(409);
    expect(finalized.body.error.code).toBe('INVOICE_FINALIZED');
    await request(server)
      .delete(base + '/' + id)
      .set(auth())
      .set('If-Match', '3')
      .expect(409);
    const repeated = await request(server)
      .post(base + '/' + id + '/issue')
      .set(auth())
      .set('If-Match', '3')
      .send({})
      .expect(409);
    expect(repeated.body.error.code).toBe('INVALID_INVOICE_STATE');
  });
  it('audits draft deletion and cancel/void commands, retaining issued documents and evidence', async () => {
    const deleted = (await create()).body.data;
    await request(server)
      .delete(base + '/' + deleted.id)
      .set(auth())
      .set('If-Match', '1')
      .send({ total: '1' })
      .expect(400);
    await request(server)
      .delete(base + '/' + deleted.id)
      .set(auth())
      .set('If-Match', '1')
      .expect(204);
    await request(server)
      .get(base + '/' + deleted.id)
      .set(auth())
      .expect(404);
    for (const action of ['cancel', 'void']) {
      const draft = (await create()).body.data;
      await request(server)
        .post(base + '/' + draft.id + '/issue')
        .set(auth())
        .set('If-Match', '1')
        .expect(200);
      await request(server)
        .post(base + '/' + draft.id + '/' + action)
        .set(auth())
        .send({ reason: '  Invalid document  ' })
        .expect(200);
      const detail = (
        await request(server)
          .get(base + '/' + draft.id)
          .set(auth())
          .expect(200)
      ).body.data;
      expect(detail).toMatchObject({
        status: action === 'cancel' ? 'CANCELLED' : 'VOID',
        paymentState: 'NOT_APPLICABLE',
        isOverdue: false,
        balanceDue: '118.01',
      });
      expect(detail[action === 'cancel' ? 'cancelReason' : 'voidReason']).toBe('Invalid document');
      await request(server)
        .post(base + '/' + draft.id + '/' + action)
        .set(auth())
        .send({ reason: 'Again' })
        .expect(409);
      await request(server)
        .delete(base + '/' + draft.id)
        .set(auth())
        .set('If-Match', '3')
        .expect(409);
    }
    expect(await prisma.auditLog.count({ where: { entityType: 'Invoice' } })).toBe(8);
  });
  it('rejects unknown/protected fields, nested mass assignment, decimal syntax, invalid items/dates and missing version headers', async () => {
    for (const override of [
      { organizationId: randomUUID() },
      { status: 'ISSUED' },
      { currency: 'USD' },
      { total: '1' },
      { invoiceNumber: 'OWN' },
      { purchaseOrderReference: 'deferred' },
      { items: [] },
      { discount: { type: 'NONE', value: '0', total: '1' } },
      { items: [{ ...input().items[0], lineAmount: '1' }] },
      { items: [{ ...input().items[0], unitPrice: 10 }] },
      { items: [{ ...input().items[0], quantity: '1e2' }] },
      { items: [{ ...input().items[0], quantity: '1.0000001' }] },
      { taxRate: null },
      { customerId: null },
    ])
      await request(server).post(base).set(auth()).send(input(override)).expect(400);
    for (const override of [{ dueDate: '2026-02-30' }, { dueDate: '2025-12-31' }])
      await request(server).post(base).set(auth()).send(input(override)).expect(400);
    for (const override of [
      { items: [{ ...input().items[0], quantity: '0' }] },
      { taxRate: '101' },
      { discount: { type: 'FIXED', value: '0.001' } },
    ])
      await request(server).post(base).set(auth()).send(input(override)).expect(422);
    const draft = (await create()).body.data;
    for (const header of [undefined, '"1', '0', '2147483648', '*']) {
      const req = request(server)
        .patch(base + '/' + draft.id)
        .set(auth());
      if (header !== undefined) req.set('If-Match', header);
      await req.send({ taxRate: '0' }).expect(400);
    }
    await request(server)
      .patch(base + '/' + draft.id)
      .set(auth())
      .set('If-Match', '1')
      .send({})
      .expect(400);
    await request(server)
      .post(base + '/' + draft.id + '/issue')
      .set(auth())
      .set('If-Match', '1')
      .send({ total: '1' })
      .expect(400);
    await request(server)
      .post(base + '/' + draft.id + '/cancel')
      .set(auth())
      .send({ reason: ' ' })
      .expect(400);
  });
  it('conceals foreign and missing customers/invoices for all commands and denies unauthorized tenants', async () => {
    const other = await login('invoice-other@example.com');
    const orgB = await createOrganization(other, 'invoice-other');
    const b = `/api/v1/organizations/${orgB.id}`;
    const customerB = (
      await request(server)
        .post(b + '/customers')
        .set(auth(other))
        .send({ displayName: 'Foreign' })
        .expect(201)
    ).body.data;
    const invoiceB = (
      await request(server)
        .post(b + '/invoices')
        .set(auth(other))
        .send(input({ customerId: customerB.id }))
        .expect(201)
    ).body.data;
    for (const customerId of [customerB.id, randomUUID()]) {
      const response = await request(server)
        .post(base)
        .set(auth())
        .send(input({ customerId }))
        .expect(404);
      expect(response.body.error).toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Customer not found.',
      });
    }
    for (const id of [invoiceB.id, randomUUID()]) {
      const response = await request(server)
        .get(base + '/' + id)
        .set(auth())
        .expect(404);
      expect(response.body.error).toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Invoice not found.',
      });
      await request(server)
        .patch(base + '/' + id)
        .set(auth())
        .set('If-Match', '1')
        .send({ taxRate: '0' })
        .expect(404);
      await request(server)
        .delete(base + '/' + id)
        .set(auth())
        .set('If-Match', '1')
        .expect(404);
      await request(server)
        .post(base + '/' + id + '/issue')
        .set(auth())
        .set('If-Match', '1')
        .send({})
        .expect(404);
      for (const action of ['cancel', 'void'])
        await request(server)
          .post(base + '/' + id + '/' + action)
          .set(auth())
          .send({ reason: 'Attack' })
          .expect(404);
    }
    await request(server)
      .get(b + '/invoices')
      .set(auth())
      .expect(404);
    await request(server).post(base).send(input()).expect(401);
    await request(server).get('/api/v1/organizations/not-uuid/invoices').set(auth()).expect(400);
    await request(server)
      .get(base + '/not-uuid')
      .set(auth())
      .expect(400);
    expect(await prisma.invoice.count()).toBe(1);
  });
  it('uses current PostgreSQL permissions and conceals suspended/removed membership without new JWTs', async () => {
    const draft = (await create()).body.data;
    const viewer = await login('invoice-viewer@example.com');
    const membership = await prisma.membership.create({
      data: {
        organizationId: organization.id,
        userId: viewer.userId,
        role: 'VIEWER',
        status: 'ACTIVE',
      },
    });
    await request(server).get(base).set(auth(viewer)).expect(200);
    await request(server).post(base).set(auth(viewer)).send(input()).expect(403);
    await request(server)
      .patch(base + '/' + draft.id)
      .set(auth(viewer))
      .set('If-Match', '1')
      .send({ taxRate: '0' })
      .expect(403);
    await request(server)
      .post(base + '/' + draft.id + '/issue')
      .set(auth(viewer))
      .set('If-Match', '1')
      .send({})
      .expect(403);
    for (const status of ['SUSPENDED', 'REMOVED']) {
      await prisma.membership.update({ where: { id: membership.id }, data: { status } });
      await request(server).get(base).set(auth(viewer)).expect(404);
    }
    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'ACTIVE', role: 'MEMBER' },
    });
    await request(server)
      .post(base + '/' + draft.id + '/issue')
      .set(auth(viewer))
      .set('If-Match', '1')
      .send({})
      .expect(200);
    for (const action of ['cancel', 'void'])
      await request(server)
        .post(base + '/' + draft.id + '/' + action)
        .set(auth(viewer))
        .send({ reason: 'Mistake' })
        .expect(403);
  });
  it('validates list allowlists, cursor bindings and documented date range bounds', async () => {
    for (let i = 0; i < 3; i++) await create();
    const first = await request(server)
      .get(base)
      .set(auth())
      .query({ limit: '1', sortBy: 'total', sortOrder: 'asc' })
      .expect(200);
    expect(first.body.meta.hasMore).toBe(true);
    const second = await request(server)
      .get(base)
      .set(auth())
      .query({ after: first.body.meta.nextCursor, limit: '1', sortBy: 'total', sortOrder: 'asc' })
      .expect(200);
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
    for (const query of [
      { sortBy: 'status' },
      { limit: '101' },
      { organizationId: organization.id },
      { paymentState: 'BOGUS' },
      { after: first.body.meta.nextCursor },
      { after: 'bm90LWpzb24' },
      { issueDateFrom: '2026-02-30' },
      { dueDateFrom: '2026-01-02', dueDateTo: '2026-01-01' },
      { issueDateFrom: '2020-01-01', issueDateTo: '2026-01-01' },
    ])
      await request(server).get(base).set(auth()).query(query).expect(400);
  });
});
