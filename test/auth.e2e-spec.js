import 'reflect-metadata';
import { createPrivateKey, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { clearDatabase, createTestPrismaClient } from './integration/database-test-helpers.js';

const validRegistration = {
  email: 'person@example.com',
  password: 'correct horse battery staple',
  firstName: 'Test',
  lastName: 'Person',
};

describe('authentication endpoints (e2e)', () => {
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

  async function registerAndLogin(agent = request.agent(server)) {
    await agent.post('/api/v1/auth/register').send(validRegistration).expect(201);
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: validRegistration.email, password: validRegistration.password })
      .expect(200);
    return { agent, login };
  }

  it('registers only a safe global user and rejects duplicates, invalid fields, and unknown fields', async () => {
    const created = await request(server)
      .post('/api/v1/auth/register')
      .send({ ...validRegistration, email: ' Person@Example.com ' })
      .expect(201);
    expect(created.body.data).toEqual(
      expect.objectContaining({ email: 'person@example.com', status: 'ACTIVE' }),
    );
    expect(created.body.data).not.toHaveProperty('passwordHash');
    expect(created.headers['set-cookie']).toBeUndefined();
    expect(await prisma.organization.count()).toBe(0);
    await request(server).post('/api/v1/auth/register').send(validRegistration).expect(409);
    await request(server)
      .post('/api/v1/auth/register')
      .send({ ...validRegistration, email: 'not-an-email' })
      .expect(400);
    await request(server)
      .post('/api/v1/auth/register')
      .send({ ...validRegistration, password: 'too-short' })
      .expect(400);
    await request(server)
      .post('/api/v1/auth/register')
      .send({ ...validRegistration, unexpected: true })
      .expect(400);
  });

  it('logs in without account enumeration and rejects inactive users', async () => {
    await request(server).post('/api/v1/auth/register').send(validRegistration).expect(201);
    const success = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: validRegistration.email, password: validRegistration.password })
      .expect(200);
    expect(success.body.data).toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: 900,
      }),
    );
    expect(success.headers['set-cookie'][0]).toMatch(/HttpOnly.*SameSite=Lax/);
    const wrong = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: validRegistration.email, password: 'incorrect password' })
      .expect(401);
    const unknown = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'unknown@example.com', password: 'incorrect password' })
      .expect(401);
    const user = await prisma.user.findUnique({
      where: { normalizedEmail: validRegistration.email },
    });
    await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
    const inactive = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: validRegistration.email, password: validRegistration.password })
      .expect(401);
    for (const response of [wrong, unknown, inactive]) {
      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.',
        }),
      );
    }
  });

  it('returns the current user and rejects missing, malformed, expired, and revoked-session access', async () => {
    const { agent, login } = await registerAndLogin();
    const token = login.body.data.accessToken;
    const me = await agent.get('/api/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body.data.email).toBe(validRegistration.email);
    expect(me.body.data).not.toHaveProperty('passwordHash');
    await request(server).get('/api/v1/me').expect(401);
    await request(server).get('/api/v1/me').set('Authorization', 'Bearer invalid').expect(401);

    const session = await prisma.refreshSession.findFirst();
    const privateKey = createPrivateKey({
      key: Buffer.from(process.env.AUTH_ACCESS_PRIVATE_KEY_BASE64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    const expired = await new SignJWT({ sid: session.id })
      .setProtectedHeader({ alg: 'EdDSA', kid: process.env.AUTH_JWT_KEY_ID })
      .setSubject(session.userId)
      .setJti(randomUUID())
      .setIssuer(process.env.AUTH_JWT_ISSUER)
      .setAudience(process.env.AUTH_JWT_AUDIENCE)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(privateKey);
    await request(server).get('/api/v1/me').set('Authorization', `Bearer ${expired}`).expect(401);

    await agent.post('/api/v1/auth/logout').send({}).expect(204);
    await request(server).get('/api/v1/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('rotates refresh cookies once and compromises the family when the used token is replayed', async () => {
    const { agent, login } = await registerAndLogin();
    const originalCookie = login.headers['set-cookie'][0].split(';')[0];
    const refreshed = await agent.post('/api/v1/auth/refresh').send({}).expect(200);
    expect(refreshed.body.data.accessToken).toEqual(expect.any(String));
    const replay = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', originalCookie)
      .send({})
      .expect(401);
    expect(replay.body.error.code).toBe('SESSION_COMPROMISED');
    await agent.post('/api/v1/auth/refresh').send({}).expect(401);
  });

  it('rejects expired refresh credentials and clears logout credentials', async () => {
    const { agent } = await registerAndLogin();
    const session = await prisma.refreshSession.findFirst();
    const expiredAt = new Date(Date.now() - 1_000);
    await prisma.refreshToken.updateMany({
      where: { sessionId: session.id },
      data: { expiresAt: expiredAt },
    });
    await agent.post('/api/v1/auth/refresh').send({}).expect(401);

    await clearDatabase(prisma);
    const second = await registerAndLogin();
    await second.agent.post('/api/v1/auth/logout').send({}).expect(204);
    await second.agent.post('/api/v1/auth/refresh').send({}).expect(401);
  });
});
