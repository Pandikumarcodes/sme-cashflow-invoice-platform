import { AccessTokenService } from '../../src/modules/auth/tokens/access-token.service.js';
import { PasswordHasher } from '../../src/modules/auth/tokens/password-hasher.js';
import { AuthService } from '../../src/modules/auth/application/auth.service.js';
import { hashRefreshToken } from '../../src/modules/auth/domain/refresh-token.js';
import { clearDatabase, createTestPrismaClient } from './database-test-helpers.js';

const authConfig = {
  accessPrivateKeyBase64: 'MC4CAQAwBQYDK2VwBCIEIDdyP69H0Zo0OMz9ELCqVFpF9wwAIH2Fm6GGNtW6YRX8',
  accessPublicKeyBase64: 'MCowBQYDK2VwAyEABdqDMyeA8N8yOW/It/UtBCMURg8cJkEWDd0PiBwYeUw=',
  accessLifetimeSeconds: 900,
  refreshLifetimeDays: 30,
  issuer: 'integration-issuer',
  audience: 'integration-audience',
  keyId: 'integration-key',
  corsOrigins: ['http://localhost:5173'],
};

describe('auth persistence', () => {
  const prisma = createTestPrismaClient();
  const configService = { getOrThrow: () => authConfig };
  const service = new AuthService(
    { getClient: async () => prisma },
    new PasswordHasher(),
    new AccessTokenService(configService),
    configService,
  );

  beforeEach(async () => clearDatabase(prisma));
  afterAll(async () => prisma.$disconnect());

  async function registeredLogin() {
    await service.register({
      email: 'Owner@Example.com',
      password: 'correct horse battery staple',
      firstName: 'First',
      lastName: 'Owner',
    });
    return service.login({
      email: 'owner@example.com',
      password: 'correct horse battery staple',
    });
  }

  it('enforces normalized global email uniqueness', async () => {
    const input = {
      email: ' Owner@Example.com ',
      password: 'correct horse battery staple',
      firstName: 'First',
      lastName: 'Owner',
    };
    await service.register(input);
    await expect(service.register({ ...input, email: 'owner@example.com' })).rejects.toMatchObject({
      code: 'EMAIL_UNAVAILABLE',
    });
    expect(await prisma.user.count()).toBe(1);
  });

  it('atomically creates a session and only a refresh-token hash', async () => {
    const login = await registeredLogin();
    const session = await prisma.refreshSession.findFirst({ include: { tokens: true } });
    expect(session.status).toBe('ACTIVE');
    expect(session.tokens).toHaveLength(1);
    expect(session.tokens[0].tokenHash).toBe(hashRefreshToken(login.refreshToken));
    expect(JSON.stringify(session)).not.toContain(login.refreshToken);
  });

  it('rotates once, then replay compromises the family and revokes its active token', async () => {
    const login = await registeredLogin();
    const rotated = await service.refresh(login.refreshToken);
    await expect(service.refresh(login.refreshToken)).rejects.toMatchObject({
      code: 'SESSION_COMPROMISED',
    });
    const session = await prisma.refreshSession.findFirst({ include: { tokens: true } });
    expect(session.status).toBe('COMPROMISED');
    expect(
      session.tokens.find((token) => token.tokenHash === hashRefreshToken(rotated.refreshToken))
        .status,
    ).toBe('REVOKED');
  });

  it('revokes the session and active token on logout', async () => {
    const login = await registeredLogin();
    await service.logout({ rawRefreshToken: login.refreshToken });
    await expect(service.refresh(login.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_SESSION',
    });
    const session = await prisma.refreshSession.findFirst({ include: { tokens: true } });
    expect(session.status).toBe('REVOKED');
    expect(session.tokens[0].status).toBe('REVOKED');
  });

  it('does not allow two concurrent refreshes to both rotate the same token', async () => {
    const login = await registeredLogin();
    const outcomes = await Promise.allSettled([
      service.refresh(login.refreshToken),
      service.refresh(login.refreshToken),
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(outcomes.find(({ status }) => status === 'rejected').reason).toMatchObject({
      code: 'SESSION_COMPROMISED',
    });
    expect((await prisma.refreshSession.findFirst()).status).toBe('COMPROMISED');
  });

  it('rolls back session and token together when an auth transaction fails', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'rollback@example.com',
        normalizedEmail: 'rollback@example.com',
        passwordHash: await new PasswordHasher().hash('correct horse battery staple'),
        firstName: 'Roll',
        lastName: 'Back',
      },
    });
    await expect(
      prisma.$transaction(async (tx) => {
        const session = await tx.refreshSession.create({
          data: { userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
        });
        await tx.refreshToken.create({
          data: {
            sessionId: session.id,
            tokenHash: 'a'.repeat(64),
            expiresAt: session.expiresAt,
          },
        });
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');
    expect(await prisma.refreshSession.count()).toBe(0);
    expect(await prisma.refreshToken.count()).toBe(0);
  });
});
