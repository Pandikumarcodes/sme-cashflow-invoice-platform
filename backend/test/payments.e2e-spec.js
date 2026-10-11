import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { clearDatabase, createTestPrismaClient } from './integration/database-test-helpers.js';

jest.setTimeout(30000);
describe('payment HTTP workflows', () => {
  const prisma = createTestPrismaClient();
  const password = 'correct horse battery staple';
  let app;
  let server;
  let owner;
  let organization;
  let customer;
  let invoice;
  let base;
  const auth = (identity = owner) => ({ Authorization: `Bearer ${identity.token}` });
  const input = (amount = '25') => ({ amount, paymentDate: '2026-01-02', method: 'BANK_TRANSFER' });
  const reversal = { reason: 'Incorrect receipt', reversalDate: '2026-01-03' };
  async function login(email) {
    await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Payment', lastName: 'User' })
      .expect(201);
    const result = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return { token: result.body.data.accessToken, userId: result.body.data.user.id };
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
  async function draft() {
    return (
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
  }
  const record = (amount = '25', key = randomUUID(), invoiceId = invoice.id, identity = owner) =>
    request(server)
      .post(base + '/invoices/' + invoiceId + '/payments')
      .set(auth(identity))
      .set('Idempotency-Key', key)
      .send(input(amount));
  const reverse = (id, key = randomUUID(), identity = owner) =>
    request(server)
      .post(base + '/payments/' + id + '/reverse')
      .set(auth(identity))
      .set('Idempotency-Key', key)
      .send(reversal);
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer();
  });
  beforeEach(async () => {
    await clearDatabase(prisma);
    owner = await login('payment-owner@example.com');
    organization = await tenant(owner, 'payment-tenant');
    base = `/api/v1/organizations/${organization.id}`;
    customer = (
      await request(server)
        .post(base + '/customers')
        .set(auth())
        .send({ displayName: 'Customer' })
        .expect(201)
    ).body.data;
    const created = await draft();
    invoice = (
      await request(server)
        .post(base + '/invoices/' + created.id + '/issue')
        .set(auth())
        .set('If-Match', '"1"')
        .send({})
        .expect(200)
    ).body.data;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('records partial/full settlement, reads current summaries and reverses the original rows in full', async () => {
    const first = (await record().expect(201)).body.data;
    expect(first).toMatchObject({
      amount: '25.00',
      status: 'RECORDED',
      createdByUserId: owner.userId,
      invoice: {
        status: 'ISSUED',
        paymentState: 'PARTIALLY_PAID',
        balanceDue: '75.00',
        version: 3,
      },
    });
    const second = (await record('75').expect(201)).body.data;
    expect(second.invoice).toMatchObject({
      status: 'ISSUED',
      paymentState: 'PAID',
      amountPaid: '100.00',
      balanceDue: '0.00',
      version: 4,
    });
    expect(
      (
        await request(server)
          .get(base + '/payments/' + first.id)
          .set(auth())
          .expect(200)
      ).body.data.invoice.paymentState,
    ).toBe('PAID');
    expect(
      (
        await request(server)
          .get(base + '/payments')
          .set(auth())
          .expect(200)
      ).body.data,
    ).toHaveLength(2);
    const over = await record('0.01').expect(422);
    expect(over.body.error).toMatchObject({
      code: 'PAYMENT_EXCEEDS_BALANCE',
      details: { currency: 'INR', remainingBalance: '0.00' },
    });
    const key = randomUUID();
    const result = await reverse(first.id, key).expect(200);
    expect(result.body.data).toMatchObject({
      id: first.id,
      status: 'REVERSED',
      amount: '25.00',
      reversal: { amount: '25.00', reason: reversal.reason, reversedByUserId: owner.userId },
      invoice: { paymentState: 'PARTIALLY_PAID', balanceDue: '25.00', version: 5 },
    });
    expect((await reverse(first.id).expect(409)).body.error.code).toBe('PAYMENT_ALREADY_REVERSED');
    await reverse(second.id).expect(200);
    expect(
      (
        await request(server)
          .get(base + '/invoices/' + invoice.id)
          .set(auth())
          .expect(200)
      ).body.data,
    ).toMatchObject({
      status: 'ISSUED',
      paymentState: 'UNPAID',
      amountPaid: '0.00',
      balanceDue: '100.00',
      version: 6,
    });
    const replay = await reverse(first.id, key).expect(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(result.body);
    await request(server)
      .patch(base + '/payments/' + first.id)
      .set(auth())
      .send({ amount: '1' })
      .expect(404);
    await request(server)
      .delete(base + '/payments/' + first.id)
      .set(auth())
      .expect(404);
  });
  it('replays the original 201 body after further payments, reversal and void; conflicts on different intent', async () => {
    const key = randomUUID();
    const original = await record('25', key).expect(201);
    expect(original.headers['idempotency-replayed']).toBeUndefined();
    await record('10').expect(201);
    const canonical = await record('25.00', key).expect(201);
    expect(canonical.headers['idempotency-replayed']).toBe('true');
    expect(canonical.body).toEqual(original.body);
    expect((await record('26', key).expect(409)).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    const payments = (
      await request(server)
        .get(base + '/payments')
        .set(auth())
        .expect(200)
    ).body.data;
    for (const payment of payments) await reverse(payment.id).expect(200);
    await request(server)
      .post(base + '/invoices/' + invoice.id + '/void')
      .set(auth())
      .send({ reason: 'Wrong document' })
      .expect(200);
    const replay = await record('25', key).expect(201);
    expect(replay.body).toEqual(original.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
  });
  it('validates required keys and allowlists all financial and reversal input', async () => {
    const url = base + '/invoices/' + invoice.id + '/payments';
    await request(server).post(url).set(auth()).send(input()).expect(400);
    for (const key of ['short', 'a'.repeat(129), 'contains a space key'])
      await record('25', key).expect(400);
    for (const body of [
      { ...input(), amount: 25 },
      { ...input(), amount: '-1' },
      { ...input(), method: 'CRYPTO' },
      { ...input(), status: 'RECORDED' },
      { ...input(), organizationId: organization.id },
      { ...input(), reference: 'REF' },
      { ...input(), notes: 'note' },
    ])
      await request(server)
        .post(url)
        .set(auth())
        .set('Idempotency-Key', randomUUID())
        .send(body)
        .expect(400);
    for (const amount of ['0', '0.001'])
      expect((await record(amount).expect(422)).body.error.code).toBe('INVALID_PAYMENT_AMOUNT');
    expect(
      (
        await request(server)
          .post(url)
          .set(auth())
          .set('Idempotency-Key', randomUUID())
          .send({ ...input(), paymentDate: '2026-02-30' })
          .expect(422)
      ).body.error.code,
    ).toBe('INVALID_PAYMENT_DATE');
    const payment = (await record().expect(201)).body.data;
    const reverseUrl = base + '/payments/' + payment.id + '/reverse';
    await request(server).post(reverseUrl).set(auth()).send(reversal).expect(400);
    for (const body of [
      { ...reversal, amount: '1' },
      { ...reversal, status: 'REVERSED' },
      { ...reversal, reason: '' },
    ])
      await request(server)
        .post(reverseUrl)
        .set(auth())
        .set('Idempotency-Key', randomUUID())
        .send(body)
        .expect(400);
  });
  it('conceals foreign resources and tenants, requires authentication and parses UUIDs', async () => {
    const other = await login('payment-other@example.com');
    const foreignOrg = await tenant(other, 'foreign-payment');
    const foreignBase = `/api/v1/organizations/${foreignOrg.id}`;
    const foreignCustomer = (
      await request(server)
        .post(foreignBase + '/customers')
        .set(auth(other))
        .send({ displayName: 'Foreign' })
        .expect(201)
    ).body.data;
    const foreignInvoice = (
      await request(server)
        .post(foreignBase + '/invoices')
        .set(auth(other))
        .send({
          customerId: foreignCustomer.id,
          issueDate: '2026-01-01',
          dueDate: '2026-01-31',
          discount: { type: 'NONE', value: '0' },
          taxRate: '0',
          items: [{ description: 'Work', quantity: '1', unitPrice: '100', sortOrder: 0 }],
        })
        .expect(201)
    ).body.data;
    await request(server)
      .post(foreignBase + '/invoices/' + foreignInvoice.id + '/issue')
      .set(auth(other))
      .set('If-Match', '"1"')
      .send({})
      .expect(200);
    const foreignPayment = (
      await request(server)
        .post(foreignBase + '/invoices/' + foreignInvoice.id + '/payments')
        .set(auth(other))
        .set('Idempotency-Key', randomUUID())
        .send(input('10'))
        .expect(201)
    ).body.data;
    for (const id of [foreignInvoice.id, randomUUID()])
      expect((await record('1', randomUUID(), id).expect(404)).body.error.code).toBe(
        'RESOURCE_NOT_FOUND',
      );
    for (const id of [foreignPayment.id, randomUUID()]) {
      await request(server)
        .get(base + '/payments/' + id)
        .set(auth())
        .expect(404);
      await reverse(id).expect(404);
    }
    await request(server)
      .get(`/api/v1/organizations/${foreignOrg.id}/payments`)
      .set(auth())
      .expect(404);
    await request(server)
      .get(base + '/payments')
      .expect(401);
    await record('1', randomUUID(), 'invalid').expect(400);
    await request(server)
      .get(base + '/payments/invalid')
      .set(auth())
      .expect(400);
  });
  it('uses current canonical permissions for every route with the same access token', async () => {
    const member = await login('payment-accountant@example.com');
    const membership = await prisma.membership.create({
      data: {
        organizationId: organization.id,
        userId: member.userId,
        role: 'ACCOUNTANT',
        status: 'ACTIVE',
      },
    });
    const key = randomUUID();
    const payment = (await record('10', key, invoice.id, member).expect(201)).body.data;
    for (const role of ['ADMIN', 'ACCOUNTANT']) {
      await prisma.membership.update({ where: { id: membership.id }, data: { role } });
      await request(server)
        .get(base + '/payments')
        .set(auth(member))
        .expect(200);
      await request(server)
        .get(base + '/payments/' + payment.id)
        .set(auth(member))
        .expect(200);
      const next = (await record('1', randomUUID(), invoice.id, member).expect(201)).body.data;
      await reverse(next.id, randomUUID(), member).expect(200);
    }
    for (const role of ['MEMBER', 'VIEWER']) {
      await prisma.membership.update({ where: { id: membership.id }, data: { role } });
      await record('10', key, invoice.id, member).expect(403);
      await reverse(payment.id, randomUUID(), member).expect(403);
      await request(server)
        .get(base + '/payments')
        .set(auth(member))
        .expect(403);
      await request(server)
        .get(base + '/payments/' + payment.id)
        .set(auth(member))
        .expect(403);
    }
    await prisma.membership.update({ where: { id: membership.id }, data: { status: 'SUSPENDED' } });
    await request(server)
      .get(base + '/payments')
      .set(auth(member))
      .expect(404);
    await record('10', key, invoice.id, member).expect(404);
  });
  it('rejects draft/cancelled/void payments and protects payment history from cancellation', async () => {
    const pending = await draft();
    expect((await record('1', randomUUID(), pending.id).expect(409)).body.error.code).toBe(
      'INVALID_INVOICE_STATE',
    );
    const payment = (await record().expect(201)).body.data;
    await request(server)
      .post(base + '/invoices/' + invoice.id + '/cancel')
      .set(auth())
      .send({ reason: 'Cancel' })
      .expect(409);
    await reverse(payment.id).expect(200);
    await request(server)
      .post(base + '/invoices/' + invoice.id + '/cancel')
      .set(auth())
      .send({ reason: 'Cancel' })
      .expect(409);
    await request(server)
      .post(base + '/invoices/' + invoice.id + '/void')
      .set(auth())
      .send({ reason: 'Void' })
      .expect(200);
    await record().expect(409);
    const cancelledDraft = await draft();
    await request(server)
      .post(base + '/invoices/' + cancelledDraft.id + '/issue')
      .set(auth())
      .set('If-Match', '"1"')
      .send({})
      .expect(200);
    await request(server)
      .post(base + '/invoices/' + cancelledDraft.id + '/cancel')
      .set(auth())
      .send({ reason: 'Cancel' })
      .expect(200);
    await record('1', randomUUID(), cancelledDraft.id).expect(409);
  });
  it('paginates and filters with bound cursors, rejecting unknown fields and malformed ranges', async () => {
    for (const amount of ['10', '20', '30']) await record(amount).expect(201);
    for (const sortBy of ['amount', 'paymentDate', 'recordedAt'])
      for (const sortOrder of ['asc', 'desc']) {
        const query = {
          invoiceId: invoice.id,
          method: 'BANK_TRANSFER',
          status: 'RECORDED',
          sortBy,
          sortOrder,
          limit: '2',
          paymentDateFrom: '2026-01-01',
          paymentDateTo: '2026-01-31',
        };
        const first = await request(server)
          .get(base + '/payments')
          .set(auth())
          .query(query)
          .expect(200);
        expect(first.body.data).toHaveLength(2);
        expect(first.body.meta.hasMore).toBe(true);
        const second = await request(server)
          .get(base + '/payments')
          .set(auth())
          .query({ ...query, after: first.body.meta.nextCursor })
          .expect(200);
        expect(second.body.data).toHaveLength(1);
        expect(new Set([...first.body.data, ...second.body.data].map((row) => row.id)).size).toBe(
          3,
        );
        await request(server)
          .get(base + '/payments')
          .set(auth())
          .query({ ...query, status: 'REVERSED', after: first.body.meta.nextCursor })
          .expect(400);
      }
    for (const query of [
      { search: 'reference' },
      { limit: '101' },
      { after: 'invalid' },
      { paymentDateFrom: '2026-02-30' },
      { paymentDateFrom: '2026-01-03', paymentDateTo: '2026-01-02' },
    ])
      await request(server)
        .get(base + '/payments')
        .set(auth())
        .query(query)
        .expect(400);
  });
});
