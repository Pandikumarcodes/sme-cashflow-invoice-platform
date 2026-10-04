import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { clearDatabase, createTestPrismaClient } from './integration/database-test-helpers.js';

const password = 'correct horse battery staple';
const validOrganization = {
  legalName: 'Acme Private Limited',
  displayName: 'Acme',
  slug: 'acme-india',
  baseCurrency: 'inr',
  timezone: 'Asia/Kolkata',
  locale: 'en-IN',
  invoicePrefix: 'inv-',
  invoiceNumberPadding: 6,
  defaultPaymentTermsDays: 30,
};

describe('organization endpoints (e2e)', () => {
  const prisma = createTestPrismaClient();
  let app;
  let server;

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = testingModule.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer();
  });

  beforeEach(async () => clearDatabase(prisma));

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function registerAndLogin(email) {
    await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Test', lastName: 'User' })
      .expect(201);
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const user = await prisma.user.findUnique({ where: { normalizedEmail: email } });
    return { user, token: login.body.data.accessToken };
  }

  function authenticated(token) {
    return { Authorization: `Bearer ${token}` };
  }

  async function createOrganization(token, body = validOrganization) {
    return request(server)
      .post('/api/v1/organizations')
      .set(authenticated(token))
      .send(body)
      .expect(201);
  }

  it('creates all organization roots for the authenticated actor and rejects unsafe input', async () => {
    await request(server).post('/api/v1/organizations').send(validOrganization).expect(401);
    const { user, token } = await registerAndLogin('owner@example.com');
    const created = await createOrganization(token);

    expect(created.body.data).toEqual(
      expect.objectContaining({
        legalName: 'Acme Private Limited',
        displayName: 'Acme',
        baseCurrency: 'INR',
        timezone: 'Asia/Kolkata',
        invoicePrefix: 'INV-',
        status: 'ACTIVE',
        version: 1,
        membership: expect.objectContaining({ role: 'OWNER', status: 'ACTIVE' }),
      }),
    );
    const membership = await prisma.membership.findFirst({
      where: { organizationId: created.body.data.id },
    });
    expect(membership.userId).toBe(user.id);
    expect(await prisma.invoiceSequence.count()).toBe(1);
    expect(await prisma.expenseCategory.count()).toBeGreaterThan(0);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'ORGANIZATION_CREATED' } }),
    ).toMatchObject({ actorUserId: user.id, actorMembershipId: membership.id });

    await request(server)
      .post('/api/v1/organizations')
      .set(authenticated(token))
      .send({ ...validOrganization, slug: 'invalid-currency', baseCurrency: 'ZZZ' })
      .expect(422);
    await request(server)
      .post('/api/v1/organizations')
      .set(authenticated(token))
      .send({ ...validOrganization, slug: 'invalid-timezone', timezone: 'Mars/Olympus' })
      .expect(422);
    const massAssignment = await request(server)
      .post('/api/v1/organizations')
      .set(authenticated(token))
      .send({
        ...validOrganization,
        slug: 'mass-assignment',
        ownerUserId: user.id,
        status: 'CLOSED',
      })
      .expect(400);
    expect(JSON.stringify(massAssignment.body)).not.toContain('Prisma');
  });

  it('lists only active organizations reached by the current user active memberships', async () => {
    const ownerA = await registerAndLogin('owner-a@example.com');
    const ownerB = await registerAndLogin('owner-b@example.com');
    const organizationA = await createOrganization(ownerA.token, {
      ...validOrganization,
      slug: 'organization-a',
    });
    const organizationB = await createOrganization(ownerB.token, {
      ...validOrganization,
      legalName: 'Business B',
      slug: 'organization-b',
    });
    await prisma.membership.create({
      data: {
        organizationId: organizationB.body.data.id,
        userId: ownerA.user.id,
        role: 'VIEWER',
        status: 'SUSPENDED',
      },
    });

    const list = await request(server)
      .get('/api/v1/organizations')
      .set(authenticated(ownerA.token))
      .expect(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({
        id: organizationA.body.data.id,
        membership: expect.objectContaining({ role: 'OWNER', status: 'ACTIVE' }),
      }),
    ]);
    expect(JSON.stringify(list.body)).not.toContain(organizationB.body.data.id);
  });

  it('conceals cross-organization reads and updates while allowing active-member reads', async () => {
    const owner = await registerAndLogin('tenant-owner@example.com');
    const outsider = await registerAndLogin('outsider@example.com');
    const organization = await createOrganization(owner.token);
    const id = organization.body.data.id;

    const organizationB = await createOrganization(
      (await registerAndLogin('tenant-owner-b@example.com')).token,
      { ...validOrganization, legalName: 'Tenant B', slug: 'tenant-b' },
    );

    await request(server)
      .get(`/api/v1/organizations/${organizationB.body.data.id}`)
      .set(authenticated(owner.token))
      .expect(404);
    await request(server)
      .patch(`/api/v1/organizations/${organizationB.body.data.id}`)
      .set(authenticated(owner.token))
      .set('If-Match', '"1"')
      .send({ displayName: 'Cross-tenant attack' })
      .expect(404);

    await request(server)
      .get(`/api/v1/organizations/${id}`)
      .set(authenticated(outsider.token))
      .expect(404);
    await request(server)
      .patch(`/api/v1/organizations/${id}`)
      .set(authenticated(outsider.token))
      .set('If-Match', '"1"')
      .send({ displayName: 'Attack' })
      .expect(404);

    const membership = await prisma.membership.create({
      data: {
        organizationId: id,
        userId: outsider.user.id,
        role: 'VIEWER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
    await request(server)
      .get(`/api/v1/organizations/${id}`)
      .set(authenticated(outsider.token))
      .expect(200);
    await request(server)
      .patch(`/api/v1/organizations/${id}`)
      .set(authenticated(outsider.token))
      .set('If-Match', '"1"')
      .send({ displayName: 'Attack' })
      .expect(403);
    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    await request(server)
      .get(`/api/v1/organizations/${id}`)
      .set(authenticated(outsider.token))
      .expect(404);
  });

  it('uses the current database membership for every request made with the same access token', async () => {
    const owner = await registerAndLogin('rbac-owner@example.com');
    const member = await registerAndLogin('rbac-member@example.com');
    const organization = await createOrganization(owner.token, {
      ...validOrganization,
      slug: 'rbac-immediate',
    });
    const membership = await prisma.membership.create({
      data: {
        organizationId: organization.body.data.id,
        userId: member.user.id,
        role: 'ADMIN',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });

    await request(server)
      .patch(`/api/v1/organizations/${organization.body.data.id}`)
      .set(authenticated(member.token))
      .set('If-Match', '"1"')
      .send({ displayName: 'Admin update' })
      .expect(200);

    await prisma.membership.update({ where: { id: membership.id }, data: { role: 'VIEWER' } });
    await request(server)
      .patch(`/api/v1/organizations/${organization.body.data.id}`)
      .set(authenticated(member.token))
      .set('If-Match', '"2"')
      .send({ displayName: 'Denied update' })
      .expect(403);

    await prisma.membership.update({ where: { id: membership.id }, data: { role: 'ADMIN' } });
    await request(server)
      .patch(`/api/v1/organizations/${organization.body.data.id}`)
      .set(authenticated(member.token))
      .set('If-Match', '"2"')
      .send({ displayName: 'Restored update' })
      .expect(200);

    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    await request(server)
      .get(`/api/v1/organizations/${organization.body.data.id}`)
      .set(authenticated(member.token))
      .expect(404);

    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'ACTIVE', suspendedAt: null },
    });
    await request(server)
      .get(`/api/v1/organizations/${organization.body.data.id}`)
      .set(authenticated(member.token))
      .expect(200);
    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'REMOVED', removedAt: new Date() },
    });
    await request(server)
      .get(`/api/v1/organizations/${organization.body.data.id}`)
      .set(authenticated(member.token))
      .expect(404);
  });

  it('updates allowlisted settings with version, audit, and currency-lock enforcement', async () => {
    const owner = await registerAndLogin('settings-owner@example.com');
    const organization = await createOrganization(owner.token);
    const id = organization.body.data.id;
    const updated = await request(server)
      .patch(`/api/v1/organizations/${id}`)
      .set(authenticated(owner.token))
      .set('If-Match', '"1"')
      .send({ displayName: 'Acme Updated', baseCurrency: 'usd', timezone: 'America/New_York' })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      displayName: 'Acme Updated',
      baseCurrency: 'USD',
      timezone: 'America/New_York',
      version: 2,
    });
    expect(updated.headers.etag).toBe('"2"');
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'ORGANIZATION_UPDATED' } }),
    ).toMatchObject({ actorUserId: owner.user.id });

    await request(server)
      .patch(`/api/v1/organizations/${id}`)
      .set(authenticated(owner.token))
      .set('If-Match', '"1"')
      .send({ displayName: 'Stale' })
      .expect(409);
    await request(server)
      .patch(`/api/v1/organizations/${id}`)
      .set(authenticated(owner.token))
      .set('If-Match', '"2"')
      .send({ timezone: 'Invalid/Timezone' })
      .expect(422);
    await request(server)
      .patch(`/api/v1/organizations/${id}`)
      .set(authenticated(owner.token))
      .set('If-Match', '"2"')
      .send({ status: 'CLOSED' })
      .expect(400);
    await prisma.organization.update({ where: { id }, data: { currencyLockedAt: new Date() } });
    const locked = await request(server)
      .patch(`/api/v1/organizations/${id}`)
      .set(authenticated(owner.token))
      .set('If-Match', '"2"')
      .send({ baseCurrency: 'EUR' })
      .expect(409);
    expect(locked.body.error.code).toBe('CURRENCY_LOCKED');
  });

  it('closes instead of deleting and rejects subsequent ordinary organization access', async () => {
    const owner = await registerAndLogin('close-owner@example.com');
    const organization = await createOrganization(owner.token);
    const id = organization.body.data.id;
    const closed = await request(server)
      .post(`/api/v1/organizations/${id}/close`)
      .set(authenticated(owner.token))
      .send({ reason: 'Business ceased operations' })
      .expect(200);
    expect(closed.body.data).toMatchObject({ status: 'CLOSED', version: 2 });
    expect(await prisma.organization.count({ where: { id } })).toBe(1);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'ORGANIZATION_CLOSED' } }),
    ).toMatchObject({ actorUserId: owner.user.id });
    const unavailable = await request(server)
      .get(`/api/v1/organizations/${id}`)
      .set(authenticated(owner.token))
      .expect(404);
    expect(unavailable.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });
});
