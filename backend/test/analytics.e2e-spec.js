import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { clearDatabase, createTestPrismaClient } from './integration/database-test-helpers.js';

jest.setTimeout(30000);
describe('analytics HTTP contracts', () => {
  const prisma = createTestPrismaClient();
  const range = { fromDate: '2026-01-01', toDate: '2026-01-31', asOfDate: '2026-02-01' };
  let app, server, owner, organization, base;
  const auth = (identity = owner) => ({ Authorization: `Bearer ${identity.token}` });
  const get = (query = range, path = base) =>
    request(server)
      .get(path + '/analytics/summary')
      .set(auth())
      .query(query);
  const aging = (query = { asOfDate: range.asOfDate }, path = base) =>
    request(server)
      .get(path + '/analytics/receivables-aging')
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
    owner = await login('performance-owner@example.com');
    organization = await tenant(owner, 'performance-tenant');
    base = `/api/v1/organizations/${organization.id}`;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('composes invoice, partial/full settlement, reversed receipts and voided expenses through HTTP', async () => {
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
    expect(result.data).toMatchObject({
      billing: { totalInvoiced: '100.00', invoiceCounts: { ISSUED: 1 } },
      collections: {
        collected: '25.10',
        rate: '25.1000',
        sampleSize: 0,
        averagePaymentDelayDays: null,
      },
      receivables: { outstanding: '74.90', overdue: '74.90' },
      spending: { expenses: '30.20' },
      cash: { netCashFlow: '-5.10', netResult: '-5.10' },
      customers: { activeCount: 1 },
    });
    expect(result.meta).toMatchObject({
      ...range,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      basis: 'CURRENT_STATE',
    });
    expect((await aging().expect(200)).body.data.buckets[1]).toEqual({
      bucket: '1_30',
      invoiceCount: 1,
      amount: '74.90',
    });
    await request(server)
      .post(base + '/payments/' + payment.id + '/reverse')
      .set(auth())
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'Wrong', reversalDate: '2026-04-01' })
      .expect(200);
    await request(server)
      .post(base + '/expenses/' + expense.id + '/void')
      .set(auth())
      .set('If-Match', '1')
      .send({ reason: 'Wrong' })
      .expect(200);
    const corrected = (await get().expect(200)).body.data;
    expect(corrected.collections.collected).toBe('0.00');
    expect(corrected.cash.netResult).toBe('0.00');
    expect(corrected.receivables.outstanding).toBe('100.00');
    await request(server)
      .post(base + '/invoices/' + draft.id + '/payments')
      .set(auth())
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '100', paymentDate: '2026-01-15', method: 'BANK_TRANSFER' })
      .expect(201);
    const paid = (await get().expect(200)).body.data;
    expect(paid.collections).toMatchObject({
      rate: '100.0000',
      sampleSize: 1,
      averagePaymentDelayDays: '-16.00',
    });
    expect(paid.receivables).toEqual({ outstanding: '0.00', overdue: '0.00' });
  });
  it('allowlists inputs for both routes, validates calendar/range/as-of semantics and returns empty defaults', async () => {
    for (const query of [
      { ...range, groupBy: 'month' },
      { ...range, organizationId: organization.id },
      { ...range, fromDate: '2026-02-30' },
      { ...range, asOfDate: '2025-12-31' },
      { ...range, toDate: '2025-12-31' },
      { fromDate: '2024-01-01', toDate: '2025-01-01' },
    ]) {
      const response = await get(query).expect(400);
      expect(JSON.stringify(response.body)).not.toMatch(/SELECT|Prisma|stack|constraint/i);
    }
    await get({ fromDate: '2024-01-01', toDate: '2024-12-31', asOfDate: '2025-01-01' }).expect(200);
    for (const query of [
      { asOfDate: '2026-02-30' },
      { fromDate: '2026-01-01' },
      { asOfDate: ['2026-01-01', '2026-01-02'] },
    ])
      await aging(query).expect(400);
    const defaults = (await get({}).expect(200)).body;
    expect(defaults.meta.fromDate).toMatch(/^\d{4}-\d{2}-01$/);
    expect(defaults.meta).toMatchObject({
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      basis: 'CURRENT_STATE',
    });
    expect(defaults.data.collections).toEqual({
      collected: '0.00',
      rate: null,
      averagePaymentDelayDays: null,
      sampleSize: 0,
    });
    const empty = (await aging({}).expect(200)).body;
    expect(empty.data.outstanding).toBe('0.00');
    expect(empty.data.buckets).toHaveLength(5);
  });
  it('uses current analytics permissions and membership on both routes with the same JWT', async () => {
    const where = {
      organizationId_userId: { organizationId: organization.id, userId: owner.userId },
    };
    for (const role of ['VIEWER', 'ACCOUNTANT', 'ADMIN']) {
      await prisma.membership.update({ where, data: { role } });
      await get().expect(200);
      await aging().expect(200);
    }
    await prisma.membership.update({ where, data: { role: 'MEMBER' } });
    await get().expect(403);
    await aging().expect(403);
    await prisma.membership.update({ where, data: { status: 'SUSPENDED' } });
    await get().expect(404);
    await aging().expect(404);
  });
  it('requires active authentication and conceals foreign/missing organizations on both routes', async () => {
    const other = await login('analytics-other@example.com');
    const foreign = await tenant(other, 'analytics-foreign');
    for (const call of [get, aging]) {
      const query = call === get ? range : { asOfDate: range.asOfDate };
      const hidden = await call(query, `/api/v1/organizations/${foreign.id}`).expect(404);
      const missing = await call(query, `/api/v1/organizations/${randomUUID()}`).expect(404);
      expect(hidden.body.error.code).toBe(missing.body.error.code);
    }
    for (const route of ['summary', 'receivables-aging'])
      await request(server)
        .get(base + '/analytics/' + route)
        .expect(401);
    await prisma.user.update({ where: { id: owner.userId }, data: { status: 'DISABLED' } });
    await get().expect(401);
    await aging().expect(401);
  });
});
