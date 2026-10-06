import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { clearDatabase, createTestPrismaClient } from './integration/database-test-helpers.js';

jest.setTimeout(30000);
describe('expense category and expense HTTP workflows', () => {
  const prisma = createTestPrismaClient();
  let app, server, owner, organization, category, base;
  const auth = (identity = owner) => ({ Authorization: `Bearer ${identity.token}` });
  const input = (extra = {}) => ({
    categoryId: category.id,
    amount: '10.25',
    expenseDate: '2026-01-02',
    description: ' Office costs ',
    ...extra,
  });
  async function login(email) {
    const password = 'correct horse battery staple';
    await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Expense', lastName: 'User' })
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
  const create = (extra = {}, identity = owner) =>
    request(server)
      .post(base + '/expenses')
      .set(auth(identity))
      .send(input(extra));
  const patch = (id, version, body, identity = owner) =>
    request(server)
      .patch(base + '/expenses/' + id)
      .set(auth(identity))
      .set('If-Match', String(version))
      .send(body);
  const voidExpense = (id, version, identity = owner) =>
    request(server)
      .post(base + '/expenses/' + id + '/void')
      .set(auth(identity))
      .set('If-Match', String(version))
      .send({ reason: ' Incorrect entry ' });
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
    owner = await login('expense-owner@example.com');
    organization = await tenant(owner, 'expense-tenant');
    base = `/api/v1/organizations/${organization.id}`;
    category = (
      await request(server)
        .get(base + '/expense-categories')
        .set(auth())
        .expect(200)
    ).body.data[0];
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  it('lists eight defaults, creates/normalizes/updates categories, and archives defaults idempotently without Category ETags', async () => {
    const defaults = await request(server)
      .get(base + '/expense-categories')
      .set(auth())
      .expect(200);
    expect(defaults.body.data).toHaveLength(8);
    expect(defaults.body.meta.limit).toBe(25);
    const created = await request(server)
      .post(base + '/expense-categories')
      .set(auth())
      .send({ name: '  Test\t Category  ', description: ' Details ' })
      .expect(201);
    expect(created.body.data).toMatchObject({
      name: 'Test Category',
      description: 'Details',
      status: 'ACTIVE',
      systemKey: null,
    });
    expect(created.body.data.version).toBeUndefined();
    // Express may emit a transport cache ETag; the endpoint has no resource version contract.
    const duplicate = await request(server)
      .post(base + '/expense-categories')
      .set(auth())
      .send({ name: 'test category' })
      .expect(409);
    expect(duplicate.body.error.code).toBe('EXPENSE_CATEGORY_ALREADY_EXISTS');
    const updated = await request(server)
      .patch(base + '/expense-categories/' + created.body.data.id)
      .set(auth())
      .send({ name: 'Renamed' })
      .expect(200);
    expect(updated.body.data.name).toBe('Renamed');
    const expense = (await create().expect(201)).body.data;
    const reassigned = await patch(expense.id, 1, { categoryId: created.body.data.id }).expect(200);
    expect(reassigned.body.data).toMatchObject({
      categoryId: created.body.data.id,
      category: { name: 'Renamed', status: 'ACTIVE' },
      version: 2,
    });
    const url = base + '/expense-categories/' + category.id;
    const archived = await request(server)
      .post(url + '/archive')
      .set(auth())
      .send({})
      .expect(200);
    expect(archived.body.data.systemKey).toBe(category.systemKey);
    const repeat = await request(server)
      .post(url + '/archive')
      .set(auth())
      .send({})
      .expect(200);
    expect(repeat.body.data).toEqual(archived.body.data);
    expect(
      (await request(server).patch(url).set(auth()).send({ name: 'Rejected' }).expect(409)).body
        .error.code,
    ).toBe('EXPENSE_CATEGORY_NOT_EDITABLE');
    expect(
      (
        await request(server)
          .get(base + '/expense-categories')
          .set(auth())
          .query({ status: 'ARCHIVED' })
          .expect(200)
      ).body.data,
    ).toHaveLength(1);
    const first = await request(server)
      .get(base + '/expense-categories')
      .set(auth())
      .query({ limit: '2' })
      .expect(200);
    const next = await request(server)
      .get(base + '/expense-categories')
      .set(auth())
      .query({ limit: '2', after: first.body.meta.nextCursor })
      .expect(200);
    expect(new Set([...first.body.data, ...next.body.data].map((row) => row.id)).size).toBe(4);
    await request(server)
      .get(base + '/expense-categories')
      .set(auth())
      .query({ status: 'ARCHIVED', after: first.body.meta.nextCursor })
      .expect(400);
  });
  it('creates, reads, edits and voids with ETags, nullable clearing and retained archived category summaries', async () => {
    const created = await create({
      vendorPayee: ' Vendor ',
      reference: ' REF ',
      notes: ' Private memo ',
    }).expect(201);
    const row = created.body.data;
    expect(created.headers.etag).toBe('"1"');
    expect(row).toMatchObject({
      amount: '10.25',
      currency: 'INR',
      expenseDate: '2026-01-02',
      description: 'Office costs',
      vendorPayee: 'Vendor',
      status: 'ACTIVE',
      createdByUserId: owner.userId,
      version: 1,
    });
    expect(
      (
        await request(server)
          .get(base + '/expenses/' + row.id)
          .set(auth())
          .expect(200)
      ).headers.etag,
    ).toBe('"1"');
    await request(server)
      .post(base + '/expense-categories/' + category.id + '/archive')
      .set(auth())
      .send({})
      .expect(200);
    expect((await create().expect(409)).body.error.code).toBe('EXPENSE_CATEGORY_INACTIVE');
    const updated = await patch(row.id, 1, {
      categoryId: category.id,
      notes: null,
      reference: null,
      vendorPayee: null,
      amount: '20',
    }).expect(200);
    expect(updated.headers.etag).toBe('"2"');
    expect(updated.body.data).toMatchObject({
      amount: '20.00',
      notes: null,
      reference: null,
      vendorPayee: null,
      category: { status: 'ARCHIVED' },
      version: 2,
    });
    expect((await patch(row.id, 1, { description: 'Stale' }).expect(409)).body.error.code).toBe(
      'CONCURRENT_MODIFICATION',
    );
    expect((await voidExpense(row.id, 1).expect(409)).body.error.code).toBe(
      'CONCURRENT_MODIFICATION',
    );
    const voided = await voidExpense(row.id, 2).expect(200);
    expect(voided.headers.etag).toBe('"3"');
    expect(voided.body.data).toMatchObject({
      status: 'VOIDED',
      voidedByUserId: owner.userId,
      voidReason: 'Incorrect entry',
      version: 3,
    });
    expect((await voidExpense(row.id, 3).expect(409)).body.error.code).toBe(
      'EXPENSE_ALREADY_VOIDED',
    );
    expect((await patch(row.id, 3, { notes: 'Attempt' }).expect(409)).body.error.code).toBe(
      'EXPENSE_NOT_EDITABLE',
    );
    expect(
      (
        await request(server)
          .get(base + '/expenses')
          .set(auth())
          .expect(200)
      ).body.data,
    ).toEqual([]);
    expect(
      (
        await request(server)
          .get(base + '/expenses')
          .set(auth())
          .query({ status: 'VOIDED' })
          .expect(200)
      ).body.data,
    ).toHaveLength(1);
    expect(
      (
        await request(server)
          .get(base + '/expenses/' + row.id)
          .set(auth())
          .expect(200)
      ).body.data.status,
    ).toBe('VOIDED');
  });
  it('allowlists input, distinguishes semantic errors and rejects missing/malformed versions and unapproved routes', async () => {
    for (const extra of [
      { amount: 10 },
      { amount: '1e2' },
      { amount: '-1' },
      { expenseDate: '2026/01/01' },
      { expenseDate: null },
      { description: ' ' },
      { currency: 'JPY' },
      { expenseCategoryId: category.id },
      { status: 'VOIDED' },
      { organizationId: organization.id },
      { version: 1 },
      { actorUserId: owner.userId },
      { notes: 'x'.repeat(1001) },
    ])
      expect((await create(extra).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    for (const amount of ['0', '0.001'])
      expect((await create({ amount }).expect(422)).body.error.code).toBe('INVALID_MONEY');
    expect((await create({ expenseDate: '2026-02-30' }).expect(422)).body.error.code).toBe(
      'EXPENSE_INVALID_DATE',
    );
    for (const body of [
      { name: 'Test', systemKey: 'OTHER' },
      { name: 'Test', normalizedName: 'test' },
      { name: ' ' },
      { name: 'Test', description: 'x'.repeat(501) },
    ])
      await request(server)
        .post(base + '/expense-categories')
        .set(auth())
        .send(body)
        .expect(400);
    const row = (await create().expect(201)).body.data;
    for (const operation of ['patch', 'void']) {
      const url = base + '/expenses/' + row.id + (operation === 'void' ? '/void' : '');
      const body = operation === 'void' ? { reason: 'Wrong' } : { description: 'Updated' };
      await request(server)
        [operation === 'void' ? 'post' : 'patch'](url)
        .set(auth())
        .send(body)
        .expect(400);
      for (const version of ['bad', '0', '2147483648', '"1", "2"'])
        await request(server)
          [operation === 'void' ? 'post' : 'patch'](url)
          .set(auth())
          .set('If-Match', version)
          .send(body)
          .expect(400);
    }
    for (const body of [
      {},
      { amount: null },
      { description: null },
      { categoryId: null },
      { expenseDate: null },
      { status: 'VOIDED' },
      { notes: ' ' },
    ])
      await patch(row.id, 1, body).expect(400);
    await request(server)
      .post(base + '/expenses/' + row.id + '/void')
      .set(auth())
      .set('If-Match', '1')
      .send({ reason: ' ', amount: '1' })
      .expect(400);
    await request(server)
      .post(base + '/expense-categories/' + category.id + '/archive')
      .set(auth())
      .send({ reason: 'unexpected' })
      .expect(400);
    await request(server)
      .get(base + '/expense-categories/' + category.id)
      .set(auth())
      .expect(404);
    await request(server)
      .delete(base + '/expense-categories/' + category.id)
      .set(auth())
      .expect(404);
    await request(server)
      .delete(base + '/expenses/' + row.id)
      .set(auth())
      .expect(404);
    for (const action of ['archive', 'restore', 'cancel'])
      await request(server)
        .post(base + '/expenses/' + row.id + '/' + action)
        .set(auth())
        .send({})
        .expect(404);
    await request(server)
      .post(base + '/expense-categories/' + category.id + '/restore')
      .set(auth())
      .send({})
      .expect(404);
  });
  it('enforces current permissions on all nine APIs with the same JWT', async () => {
    const identity = await login('expense-accountant@example.com');
    const membership = await prisma.membership.create({
      data: {
        organizationId: organization.id,
        userId: identity.userId,
        role: 'ACCOUNTANT',
        status: 'ACTIVE',
      },
    });
    const row = (await create({}, identity).expect(201)).body.data;
    const calls = () => [
      () =>
        request(server)
          .get(base + '/expense-categories')
          .set(auth(identity)),
      () =>
        request(server)
          .get(base + '/expenses')
          .set(auth(identity)),
      () =>
        request(server)
          .get(base + '/expenses/' + row.id)
          .set(auth(identity)),
      () =>
        request(server)
          .post(base + '/expense-categories')
          .set(auth(identity))
          .send({ name: 'New ' + randomUUID() }),
      () =>
        request(server)
          .patch(base + '/expense-categories/' + category.id)
          .set(auth(identity))
          .send({ description: 'Updated' }),
      () =>
        request(server)
          .post(base + '/expense-categories/' + category.id + '/archive')
          .set(auth(identity))
          .send({}),
      () => create({}, identity),
      () => patch(row.id, 1, { notes: 'Update' }, identity),
      () => voidExpense(row.id, 1, identity),
    ];
    for (const role of ['VIEWER', 'MEMBER']) {
      await prisma.membership.update({ where: { id: membership.id }, data: { role } });
      const requests = calls();
      for (let i = 0; i < requests.length; i++)
        await requests[i]().expect(role === 'VIEWER' && i < 3 ? 200 : 403);
    }
    await prisma.membership.update({ where: { id: membership.id }, data: { role: 'ADMIN' } });
    await patch(row.id, 1, { notes: 'Admin correction' }, identity).expect(200);
    await prisma.membership.update({ where: { id: membership.id }, data: { status: 'SUSPENDED' } });
    for (const call of calls()) await call().expect(404);
    await request(server)
      .get(base + '/expenses')
      .expect(401);
  });
  it('conceals foreign and absent resources identically and rejects foreign categories', async () => {
    const other = await login('expense-other@example.com');
    const foreignOrg = await tenant(other, 'expense-foreign');
    const foreignBase = `/api/v1/organizations/${foreignOrg.id}`;
    const foreignCategory = (
      await request(server)
        .get(foreignBase + '/expense-categories')
        .set(auth(other))
        .expect(200)
    ).body.data[0];
    const foreignExpense = (
      await request(server)
        .post(foreignBase + '/expenses')
        .set(auth(other))
        .send(input({ categoryId: foreignCategory.id }))
        .expect(201)
    ).body.data;
    const ownExpense = (await create().expect(201)).body.data;
    for (const id of [foreignCategory.id, randomUUID()]) {
      const result = await create({ categoryId: id }).expect(404);
      expect(result.body.error.code).toBe('RESOURCE_NOT_FOUND');
      await patch(ownExpense.id, 1, { categoryId: id }).expect(404);
      await request(server)
        .patch(base + '/expense-categories/' + id)
        .set(auth())
        .send({ name: 'Attack' })
        .expect(404);
      await request(server)
        .post(base + '/expense-categories/' + id + '/archive')
        .set(auth())
        .send({})
        .expect(404);
    }
    for (const id of [foreignExpense.id, randomUUID()]) {
      await request(server)
        .get(base + '/expenses/' + id)
        .set(auth())
        .expect(404);
      await patch(id, 1, { description: 'Attack' }).expect(404);
      await voidExpense(id, 1).expect(404);
    }
    await request(server)
      .get(foreignBase + '/expenses')
      .set(auth())
      .expect(404);
    await request(server)
      .get(base + '/expenses/not-a-uuid')
      .set(auth())
      .expect(400);
  });
  it('paginates all sorts including null vendor tails, binds filters and performs literal vendor matching', async () => {
    const rows = [];
    for (const vendorPayee of ['Acme%_', 'ACME%_', null, null, 'Other'])
      rows.push((await create({ vendorPayee }).expect(201)).body.data);
    for (const sortBy of ['expenseDate', 'createdAt', 'amount', 'vendorPayee'])
      for (const sortOrder of ['asc', 'desc']) {
        const query = {
          sortBy,
          sortOrder,
          limit: '2',
          categoryId: category.id,
          expenseDateFrom: '2026-01-02',
          expenseDateTo: '2026-01-02',
        };
        let after;
        const ids = [];
        const vendors = [];
        do {
          const page = await request(server)
            .get(base + '/expenses')
            .set(auth())
            .query({ ...query, ...(after ? { after } : {}) })
            .expect(200);
          ids.push(...page.body.data.map((row) => row.id));
          vendors.push(...page.body.data.map((row) => row.vendorPayee));
          after = page.body.meta.nextCursor;
        } while (after);
        expect(new Set(ids).size).toBe(5);
        expect(ids).toHaveLength(5);
        if (sortBy === 'vendorPayee') expect(vendors.slice(-2)).toEqual([null, null]);
      }
    expect(
      (
        await request(server)
          .get(base + '/expenses')
          .set(auth())
          .query({ vendor: 'acme%_' })
          .expect(200)
      ).body.data,
    ).toHaveLength(2);
    const first = await request(server)
      .get(base + '/expenses')
      .set(auth())
      .query({ limit: '1' })
      .expect(200);
    expect(
      (
        await request(server)
          .get(base + '/expenses')
          .set(auth())
          .query({ status: 'VOIDED', after: first.body.meta.nextCursor })
          .expect(400)
      ).body.error.code,
    ).toBe('INVALID_CURSOR');
    for (const query of [
      { limit: '101' },
      { search: 'x' },
      { status: 'ALL' },
      { expenseDateFrom: '2026/01/01' },
      { expenseDateFrom: '2026-01-03', expenseDateTo: '2026-01-01' },
      { expenseDateFrom: '2020-01-01', expenseDateTo: '2026-01-01' },
    ])
      await request(server)
        .get(base + '/expenses')
        .set(auth())
        .query(query)
        .expect(400);
    expect(
      (
        await request(server)
          .get(base + '/expenses')
          .set(auth())
          .query({ expenseDateFrom: '2026-02-30' })
          .expect(422)
      ).body.error.code,
    ).toBe('EXPENSE_INVALID_DATE');
    expect(
      (
        await request(server)
          .get(base + '/expenses')
          .set(auth())
          .query({ after: 'invalid' })
          .expect(400)
      ).body.error.code,
    ).toBe('INVALID_CURSOR');
    expect(
      (
        await request(server)
          .get(base + '/expenses')
          .set(auth())
          .query({ after: ['invalid', 'another'] })
          .expect(400)
      ).body.error.code,
    ).toBe('INVALID_CURSOR');
    for (const query of [{ sortBy: 'name' }, { search: 'x' }])
      await request(server)
        .get(base + '/expense-categories')
        .set(auth())
        .query(query)
        .expect(400);
  });
});
