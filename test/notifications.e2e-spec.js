import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { RemindersService } from '../src/modules/notifications/application/reminders.service.js';
import { clearDatabase, createTestPrismaClient } from './integration/database-test-helpers.js';
import { REMINDER_NOW, eventJob } from './helpers/notification-fixture.js';

jest.setTimeout(30000);
describe('notification HTTP contracts', () => {
  const prisma = createTestPrismaClient();
  let app, server, owner, org, base;
  const auth = (identity = owner) => ({ Authorization: `Bearer ${identity.token}` });
  async function identity(email) {
    const password = 'correct horse battery staple';
    await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Inbox', lastName: 'User' })
      .expect(201);
    const result = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return { token: result.body.data.accessToken, userId: result.body.data.user.id };
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
  const command = (id, action, body = {}) =>
    request(server)
      .post(base + '/' + id + '/' + action)
      .set(auth())
      .send(body);
  const seed = (recipientUserId = owner.userId, organizationId = org.id) =>
    prisma.notification.create({
      data: {
        organizationId,
        recipientUserId,
        type: 'SYSTEM',
        title: 'Notice',
        body: 'Safe inbox content',
        createdAt: new Date('2026-01-01'),
      },
    });
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer();
    app.get(RemindersService).clock = () => REMINDER_NOW;
  });
  beforeEach(async () => {
    await clearDatabase(prisma);
    owner = await identity('inbox-owner@example.com');
    org = await organization(owner, 'inbox-tenant');
    base = `/api/v1/organizations/${org.id}/notifications`;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  it('lists source-event notifications after actual invoice/payment HTTP workflows', async () => {
    const prefix = `/api/v1/organizations/${org.id}`;
    const customer = (
      await request(server)
        .post(prefix + '/customers')
        .set(auth())
        .send({ displayName: 'Buyer' })
        .expect(201)
    ).body.data;
    const draft = (
      await request(server)
        .post(prefix + '/invoices')
        .set(auth())
        .send({
          customerId: customer.id,
          issueDate: '2026-01-01',
          dueDate: '2026-01-31',
          discount: { type: 'NONE', value: '0' },
          taxRate: '0',
          items: [{ description: 'Work', quantity: '1', unitPrice: '1000', sortOrder: 0 }],
        })
        .expect(201)
    ).body.data;
    await request(server)
      .post(prefix + '/invoices/' + draft.id + '/issue')
      .set(auth())
      .set('If-Match', '1')
      .send({})
      .expect(200);
    await request(server)
      .post(prefix + '/invoices/' + draft.id + '/payments')
      .set(auth())
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '0.30', paymentDate: '2026-01-31', method: 'BANK_TRANSFER' })
      .expect(201);
    const reminders = app.get(RemindersService);
    for (const event of await prisma.pendingEvent.findMany({ where: { organizationId: org.id } }))
      await reminders.handleEvent(eventJob(event), 'IN_APP');
    for (const event of await prisma.pendingEvent.findMany({
      where: { organizationId: org.id, eventType: 'REMINDER_DELIVERY_REQUESTED' },
    }))
      await reminders.handleEvent(eventJob(event), 'IN_APP');
    const response = (await list().expect(200)).body;
    expect(response.data.map((row) => row.type).sort()).toEqual([
      'INVOICE_OVERDUE',
      'PAYMENT_RECORDED',
    ]);
    expect(response.data.find((row) => row.type === 'INVOICE_OVERDUE').body).toContain(
      '999.70 INR',
    );
    expect(JSON.stringify(response)).not.toMatch(
      /deduplicationKey|recipientUserId|providerMessageId/,
    );
  });
  it('paginates timestamp ties, filters states and preserves idempotent read/archive timestamps', async () => {
    const rows = [await seed(), await seed(), await seed()];
    const first = (await list({ limit: '1' }).expect(200)).body;
    const second = (await list({ limit: '1', after: first.meta.nextCursor }).expect(200)).body;
    const third = (await list({ limit: '1', after: second.meta.nextCursor }).expect(200)).body;
    expect(new Set([first.data[0].id, second.data[0].id, third.data[0].id]).size).toBe(3);
    expect(third.meta).toMatchObject({ hasMore: false, nextCursor: null });
    const read = (await command(rows[0].id, 'read').expect(200)).body.data;
    expect((await command(rows[0].id, 'read').expect(200)).body.data).toEqual(read);
    expect((await list({ status: 'READ' }).expect(200)).body.data).toHaveLength(1);
    const archived = (await command(rows[0].id, 'archive').expect(200)).body.data;
    expect((await command(rows[0].id, 'archive').expect(200)).body.data).toEqual(archived);
    expect((await command(rows[0].id, 'read').expect(200)).body.data).toEqual(archived);
    expect((await list().expect(200)).body.data).toHaveLength(2);
    await list({ limit: '1', after: first.meta.nextCursor, status: 'READ' }).expect(400);
  });
  it('allowlists inputs, supports every canonical role and rechecks current membership', async () => {
    const row = await seed();
    for (const query of [
      { limit: '0' },
      { limit: '101' },
      { sortBy: 'title' },
      { sortOrder: 'wrong' },
      { status: 'unknown' },
      { recipientUserId: owner.userId },
      { after: 'garbage' },
      { status: ['READ', 'UNREAD'] },
    ])
      await list(query).expect(400);
    for (const action of ['read', 'archive']) {
      await command(row.id, action, { status: 'READ' }).expect(400);
      await command('bad-id', action).expect(400);
    }
    const where = { organizationId_userId: { organizationId: org.id, userId: owner.userId } };
    for (const role of ['ADMIN', 'ACCOUNTANT', 'MEMBER', 'VIEWER']) {
      await prisma.membership.update({ where, data: { role } });
      await list().expect(200);
      await command(row.id, 'read').expect(200);
    }
    await prisma.membership.update({ where, data: { status: 'SUSPENDED' } });
    await list().expect(404);
    await command(row.id, 'archive').expect(404);
  });
  it('conceals foreign-tenant and other-recipient rows and requires active authentication', async () => {
    const other = await identity('inbox-other@example.com'),
      foreign = await organization(other, 'inbox-foreign');
    const foreignRow = await seed(other.userId, foreign.id),
      privateRow = await seed(other.userId);
    expect((await list().expect(200)).body.data).toEqual([]);
    for (const action of ['read', 'archive']) {
      const hidden = await command(foreignRow.id, action).expect(404);
      const missing = await command(randomUUID(), action).expect(404);
      await command(privateRow.id, action).expect(404);
      expect(hidden.body.error.code).toBe(missing.body.error.code);
      expect(JSON.stringify(hidden.body)).not.toMatch(/Prisma|SELECT|constraint|stack/i);
    }
    await request(server)
      .get(`/api/v1/organizations/${foreign.id}/notifications`)
      .set(auth())
      .expect(404);
    await request(server).get(base).expect(401);
    await prisma.user.update({ where: { id: owner.userId }, data: { status: 'DISABLED' } });
    await list().expect(401);
    await command(privateRow.id, 'read').expect(401);
  });
});
