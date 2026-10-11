import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { hashInvitationToken } from '../src/modules/memberships/domain/invitation-token.js';
import { clearDatabase, createTestPrismaClient } from './integration/database-test-helpers.js';

const password = 'correct horse battery staple';
jest.setTimeout(30_000);

describe('membership and invitation endpoints (e2e)', () => {
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
    return {
      token: login.body.data.accessToken,
      user: await prisma.user.findUnique({ where: { normalizedEmail: email } }),
    };
  }

  function authorization(token) {
    return { Authorization: `Bearer ${token}` };
  }

  async function createOrganization(token, slug) {
    const response = await request(server)
      .post('/api/v1/organizations')
      .set(authorization(token))
      .send({
        legalName: `Organization ${slug}`,
        displayName: slug,
        slug,
        baseCurrency: 'INR',
        timezone: 'Asia/Kolkata',
      })
      .expect(201);
    return response.body.data;
  }

  async function invite(token, organizationId, email, role = 'MEMBER') {
    return request(server)
      .post(`/api/v1/organizations/${organizationId}/invitations`)
      .set(authorization(token))
      .send({ email, role })
      .expect(201);
  }

  it('lists safe scoped member summaries only for membership managers', async () => {
    const owner = await registerAndLogin('list-owner@example.com');
    const viewer = await registerAndLogin('list-viewer@example.com');
    const outsider = await registerAndLogin('list-outsider@example.com');
    const organization = await createOrganization(owner.token, 'member-list');
    await prisma.membership.create({
      data: {
        organizationId: organization.id,
        userId: viewer.user.id,
        role: 'VIEWER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
    await request(server).get(`/api/v1/organizations/${organization.id}/members`).expect(401);
    const list = await request(server)
      .get(`/api/v1/organizations/${organization.id}/members?role=VIEWER&status=ACTIVE`)
      .set(authorization(owner.token))
      .expect(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({
        organizationId: organization.id,
        role: 'VIEWER',
        status: 'ACTIVE',
        user: expect.objectContaining({ email: viewer.user.email }),
      }),
    ]);
    expect(JSON.stringify(list.body)).not.toContain('passwordHash');
    await request(server)
      .get(`/api/v1/organizations/${organization.id}/members`)
      .set(authorization(viewer.token))
      .expect(403);
    await request(server)
      .get(`/api/v1/organizations/${organization.id}/members`)
      .set(authorization(outsider.token))
      .expect(404);
  });

  it('creates normalized hash-only invitations and rejects duplicates, Owner, and mass assignment', async () => {
    const owner = await registerAndLogin('invite-owner@example.com');
    const organization = await createOrganization(owner.token, 'invite-rules');
    const created = await invite(
      owner.token,
      organization.id,
      ' Invitee@Example.com ',
      'ACCOUNTANT',
    );
    expect(created.body.data).toMatchObject({
      email: 'invitee@example.com',
      role: 'ACCOUNTANT',
      status: 'PENDING',
      delivery: { mode: 'DEVELOPMENT', token: expect.any(String) },
    });
    const stored = await prisma.organizationInvitation.findUnique({
      where: { id: created.body.data.id },
    });
    expect(stored.tokenHash).toBe(hashInvitationToken(created.body.data.delivery.token));
    expect(JSON.stringify(stored)).not.toContain(created.body.data.delivery.token);
    await request(server)
      .post(`/api/v1/organizations/${organization.id}/invitations`)
      .set(authorization(owner.token))
      .send({ email: 'INVITEE@example.com', role: 'VIEWER' })
      .expect(409);
    await request(server)
      .post(`/api/v1/organizations/${organization.id}/invitations`)
      .set(authorization(owner.token))
      .send({ email: 'owner-role@example.com', role: 'OWNER' })
      .expect(400);
    await request(server)
      .post(`/api/v1/organizations/${organization.id}/invitations`)
      .set(authorization(owner.token))
      .send({ email: 'unsafe@example.com', role: 'VIEWER', organizationId: organization.id })
      .expect(400);
  });

  it('accepts only for the bound user and makes the invitation single-use', async () => {
    const owner = await registerAndLogin('accept-owner@example.com');
    const invitee = await registerAndLogin('accept-invitee@example.com');
    const wrongUser = await registerAndLogin('accept-wrong@example.com');
    const organization = await createOrganization(owner.token, 'accept-http');
    const invitation = await invite(owner.token, organization.id, invitee.user.email, 'VIEWER');
    const token = invitation.body.data.delivery.token;
    await request(server)
      .post('/api/v1/invitations/accept')
      .set(authorization(wrongUser.token))
      .send({ token })
      .expect(410);
    const accepted = await request(server)
      .post('/api/v1/invitations/accept')
      .set(authorization(invitee.token))
      .send({ token })
      .expect(200);
    expect(accepted.body.data).toMatchObject({
      organizationId: organization.id,
      role: 'VIEWER',
      status: 'ACTIVE',
      user: expect.objectContaining({ id: invitee.user.id }),
    });
    expect(accepted.headers.etag).toBe('"1"');
    await request(server)
      .post('/api/v1/invitations/accept')
      .set(authorization(invitee.token))
      .send({ token })
      .expect(410);
  });

  it('changes role, suspends, reactivates, and removes with optimistic versions', async () => {
    const owner = await registerAndLogin('lifecycle-owner@example.com');
    const memberUser = await registerAndLogin('lifecycle-member@example.com');
    const organization = await createOrganization(owner.token, 'member-http-lifecycle');
    const invitation = await invite(owner.token, organization.id, memberUser.user.email);
    const accepted = await request(server)
      .post('/api/v1/invitations/accept')
      .set(authorization(memberUser.token))
      .send({ token: invitation.body.data.delivery.token })
      .expect(200);
    const memberId = accepted.body.data.id;
    const changed = await request(server)
      .patch(`/api/v1/organizations/${organization.id}/members/${memberId}`)
      .set(authorization(owner.token))
      .set('If-Match', '"1"')
      .send({ role: 'ACCOUNTANT' })
      .expect(200);
    expect(changed.body.data).toMatchObject({ role: 'ACCOUNTANT', version: 2 });
    await request(server)
      .post(`/api/v1/organizations/${organization.id}/members/${memberId}/suspend`)
      .set(authorization(owner.token))
      .set('If-Match', '"2"')
      .send({})
      .expect(200);
    await request(server)
      .get(`/api/v1/organizations/${organization.id}`)
      .set(authorization(memberUser.token))
      .expect(404);
    await request(server)
      .post(`/api/v1/organizations/${organization.id}/members/${memberId}/reactivate`)
      .set(authorization(owner.token))
      .set('If-Match', '"3"')
      .send({})
      .expect(200);
    await request(server)
      .delete(`/api/v1/organizations/${organization.id}/members/${memberId}`)
      .set(authorization(owner.token))
      .set('If-Match', '"4"')
      .expect(204);
    await request(server)
      .get(`/api/v1/organizations/${organization.id}`)
      .set(authorization(memberUser.token))
      .expect(404);
    await request(server)
      .patch(`/api/v1/organizations/${organization.id}/members/${memberId}`)
      .set(authorization(owner.token))
      .set('If-Match', '"4"')
      .send({ role: 'VIEWER' })
      .expect(409);
  });

  it('protects Owner and conceals cross-tenant member and invitation identifiers', async () => {
    const ownerA = await registerAndLogin('scope-owner-a@example.com');
    const ownerB = await registerAndLogin('scope-owner-b@example.com');
    const memberB = await registerAndLogin('scope-member-b@example.com');
    const organizationA = await createOrganization(ownerA.token, 'scope-a');
    const organizationB = await createOrganization(ownerB.token, 'scope-b');
    const membershipB = await prisma.membership.create({
      data: {
        organizationId: organizationB.id,
        userId: memberB.user.id,
        role: 'MEMBER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
    await request(server)
      .delete(`/api/v1/organizations/${organizationA.id}/members/${organizationA.membership.id}`)
      .set(authorization(ownerA.token))
      .set('If-Match', '"1"')
      .expect(409);
    await request(server)
      .patch(`/api/v1/organizations/${organizationA.id}/members/${organizationA.membership.id}`)
      .set(authorization(ownerA.token))
      .set('If-Match', '"1"')
      .send({ role: 'ADMIN' })
      .expect(409);
    const foreign = await request(server)
      .patch(`/api/v1/organizations/${organizationA.id}/members/${membershipB.id}`)
      .set(authorization(ownerA.token))
      .set('If-Match', '"1"')
      .send({ role: 'VIEWER' })
      .expect(404);
    const missing = await request(server)
      .patch(`/api/v1/organizations/${organizationA.id}/members/${randomUUID()}`)
      .set(authorization(ownerA.token))
      .set('If-Match', '"1"')
      .send({ role: 'VIEWER' })
      .expect(404);
    expect(foreign.body.error.code).toBe(missing.body.error.code);
    expect(foreign.body.error.message).toBe(missing.body.error.message);
    await request(server)
      .post(`/api/v1/organizations/${organizationA.id}/invitations`)
      .set(authorization(ownerA.token))
      .send({ email: 'override@example.com', role: 'MEMBER', organizationId: organizationB.id })
      .expect(400);
    await request(server)
      .get(`/api/v1/organizations/${organizationA.id}/members?organizationId=${organizationB.id}`)
      .set(authorization(ownerA.token))
      .expect(400);
    const invitationA = await invite(ownerA.token, organizationA.id, 'scoped-invite@example.com');
    await request(server)
      .delete(`/api/v1/organizations/${organizationB.id}/invitations/${invitationA.body.data.id}`)
      .set(authorization(ownerB.token))
      .expect(404);
    await request(server)
      .delete(`/api/v1/organizations/${organizationA.id}/invitations/${invitationA.body.data.id}`)
      .set(authorization(ownerA.token))
      .set('X-Organization-Id', organizationB.id)
      .query({ organizationId: organizationB.id })
      .expect(204);
    expect(await prisma.membership.findUnique({ where: { id: membershipB.id } })).toMatchObject({
      role: 'MEMBER',
      version: 1,
    });
  });

  it('transfers ownership atomically and ordinary role APIs cannot assign Owner', async () => {
    const owner = await registerAndLogin('transfer-http-owner@example.com');
    const target = await registerAndLogin('transfer-http-target@example.com');
    const organization = await createOrganization(owner.token, 'transfer-http');
    const targetMembership = await prisma.membership.create({
      data: {
        organizationId: organization.id,
        userId: target.user.id,
        role: 'ADMIN',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
    await request(server)
      .patch(`/api/v1/organizations/${organization.id}/members/${targetMembership.id}`)
      .set(authorization(owner.token))
      .set('If-Match', '"1"')
      .send({ role: 'OWNER' })
      .expect(400);
    const transfer = await request(server)
      .post(`/api/v1/organizations/${organization.id}/transfer-ownership`)
      .set(authorization(owner.token))
      .send({ targetMembershipId: targetMembership.id })
      .expect(200);
    expect(transfer.body.data).toMatchObject({
      previousOwner: expect.objectContaining({ role: 'ADMIN' }),
      currentOwner: expect.objectContaining({ id: targetMembership.id, role: 'OWNER' }),
    });
    expect(
      await prisma.membership.count({
        where: { organizationId: organization.id, role: 'OWNER', status: 'ACTIVE' },
      }),
    ).toBe(1);
    await request(server)
      .post(`/api/v1/organizations/${organization.id}/transfer-ownership`)
      .set(authorization(owner.token))
      .send({ targetMembershipId: targetMembership.id })
      .expect(403);
  });
});
