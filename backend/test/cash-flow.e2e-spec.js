import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { clearDatabase, createTestPrismaClient } from './integration/database-test-helpers.js';

jest.setTimeout(30000);
describe('cash flow HTTP contract', () => {
  const prisma = createTestPrismaClient();
  const range = { fromDate: '2026-01-01', toDate: '2026-01-31', groupBy: 'day' };
  let app, server, owner, organization, base;
  const auth = (identity = owner) => ({ Authorization: `Bearer ${identity.token}` });
  const get = (query = range, path = base) =>
    request(server)
      .get(path + '/cash-flow')
      .set(auth())
      .query(query);
  async function login(email) {
    const password = 'correct horse battery staple';
    await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Cash', lastName: 'User' })
      .expect(201);
    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return { token: response.body.data.accessToken, userId: response.body.data.user.id };
  }
  async function tenant(identity, slug) {
    return (
      await request(server)
        .post('/api/v1/organizations')
        .set(auth(identity))
        .send({ legalName: slug, slug, baseCurrency: 'INR', timezone: 'Asia/Kolkata' })
        .expect(201)
    ).body.data;
  }
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
    owner = await login('cash-owner@example.com');
    organization = await tenant(owner, 'cash-tenant');
    base = `/api/v1/organizations/${organization.id}`;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  it('reports HTTP-created receipts and expenses, then applies reversal/void corrections once', async () => {
    const customer = (
      await request(server)
        .post(base + '/customers')
        .set(auth())
        .send({ displayName: 'Buyer' })
        .expect(201)
    ).body.data;
    const draft = (
      await request(server)
        .post(base + '/invoices')
        .set(auth())
        .send({
          customerId: customer.id,
          issueDate: '2026-01-01',
          dueDate: '2026-01-31',
          discount: { type: 'NONE', value: '0' },
          taxRate: '0',
          items: [{ description: 'Work', quantity: '1', unitPrice: '100', sortOrder: 0 }],
        })
        .expect(201)
    ).body.data;
    await request(server)
      .post(base + '/invoices/' + draft.id + '/issue')
      .set(auth())
      .set('If-Match', '1')
      .send({})
      .expect(200);
    expect((await get().expect(200)).body.data.inflows).toBe('0.00');
    const payment = (
      await request(server)
        .post(base + '/invoices/' + draft.id + '/payments')
        .set(auth())
        .set('Idempotency-Key', randomUUID())
        .send({ amount: '25.10', paymentDate: '2026-01-02', method: 'BANK_TRANSFER' })
        .expect(201)
    ).body.data;
    const category = (
      await request(server)
        .get(base + '/expense-categories')
        .set(auth())
        .expect(200)
    ).body.data[0];
    const expense = (
      await request(server)
        .post(base + '/expenses')
        .set(auth())
        .send({
          categoryId: category.id,
          amount: '30.20',
          expenseDate: '2026-01-02',
          description: 'Costs',
        })
        .expect(201)
    ).body.data;
    await request(server)
      .post(base + '/expense-categories/' + category.id + '/archive')
      .set(auth())
      .send({})
      .expect(200);
    const result = (await get().expect(200)).body;
    expect(result.data).toEqual({
      inflows: '25.10',
      outflows: '30.20',
      netCashFlow: '-5.10',
      series: [
        { periodStart: '2026-01-02', inflows: '25.10', outflows: '30.20', netCashFlow: '-5.10' },
      ],
    });
    expect(result.meta).toMatchObject({
      ...range,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      basis: 'cash',
    });
    await request(server)
      .post(base + '/payments/' + payment.id + '/reverse')
      .set(auth())
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'Wrong', reversalDate: '2026-02-01' })
      .expect(200);
    expect((await get().expect(200)).body.data).toMatchObject({
      inflows: '0.00',
      outflows: '30.20',
      netCashFlow: '-30.20',
    });
    await request(server)
      .post(base + '/expenses/' + expense.id + '/void')
      .set(auth())
      .set('If-Match', '1')
      .send({ reason: 'Wrong' })
      .expect(200);
    expect((await get().expect(200)).body.data).toEqual({
      inflows: '0.00',
      outflows: '0.00',
      netCashFlow: '0.00',
      series: [],
    });
  });
  it('validates the allowlisted query, real dates, inclusive limit and safe errors', async () => {
    for (const query of [
      { ...range, organizationId: organization.id },
      { ...range, groupBy: 'year' },
      { ...range, fromDate: '2026-02-30' },
      { ...range, toDate: '2025-12-31' },
      { fromDate: '2024-01-01', toDate: '2025-01-01' },
      { ...range, groupBy: ['day', 'month'] },
    ]) {
      const result = await get(query).expect(400);
      expect(result.body.error).toHaveProperty('code');
      expect(JSON.stringify(result.body)).not.toMatch(/SELECT|Prisma|stack|constraint/i);
    }
    await get({ fromDate: '2024-01-01', toDate: '2024-12-31', groupBy: 'week' }).expect(200);
    const defaults = (await get({}).expect(200)).body;
    expect(defaults.meta).toMatchObject({
      groupBy: 'month',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      basis: 'cash',
    });
    expect(defaults.meta.fromDate).toMatch(/^\d{4}-\d{2}-01$/);
    expect(defaults.data.series).toEqual([]);
  });
  it('uses current permission and membership state independently of payment-read permission', async () => {
    const where = {
      organizationId_userId: { organizationId: organization.id, userId: owner.userId },
    };
    await prisma.membership.update({ where, data: { role: 'VIEWER' } });
    await get().expect(200);
    await request(server)
      .get(base + '/payments')
      .set(auth())
      .expect(403);
    for (const role of ['ACCOUNTANT', 'ADMIN']) {
      await prisma.membership.update({ where, data: { role } });
      await get().expect(200);
    }
    await prisma.membership.update({ where, data: { role: 'MEMBER' } });
    await get().expect(403);
    await prisma.membership.update({ where, data: { status: 'SUSPENDED' } });
    await get().expect(404);
  });
  it('conceals another organization and missing organizations, and requires active authentication', async () => {
    const other = await login('cash-other@example.com');
    const foreign = await tenant(other, 'cash-foreign');
    const hidden = await get(range, `/api/v1/organizations/${foreign.id}`).expect(404);
    const missing = await get(range, `/api/v1/organizations/${randomUUID()}`).expect(404);
    expect(hidden.body.error.code).toBe(missing.body.error.code);
    await request(server)
      .get(base + '/cash-flow')
      .expect(401);
    await prisma.user.update({ where: { id: owner.userId }, data: { status: 'DISABLED' } });
    await get().expect(401);
  });
});
