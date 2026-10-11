import {
  classifyRefreshCredential,
  generateRefreshToken,
  hashRefreshToken,
} from './refresh-token.js';

function credential(overrides = {}) {
  const future = new Date('2030-01-01T00:00:00.000Z');
  return {
    status: 'ACTIVE',
    expiresAt: future,
    session: {
      status: 'ACTIVE',
      expiresAt: future,
      user: { status: 'ACTIVE' },
    },
    ...overrides,
  };
}

describe('refresh token primitives', () => {
  it('generates 256-bit opaque tokens and stable SHA-256 lookup hashes', () => {
    const first = generateRefreshToken();
    const second = generateRefreshToken();
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
    expect(first).not.toBe(second);
    expect(hashRefreshToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRefreshToken(first)).toBe(hashRefreshToken(first));
  });

  it('allows only an active credential and detects used-token replay', () => {
    const now = new Date('2029-01-01T00:00:00.000Z');
    expect(classifyRefreshCredential(credential(), now)).toBe('ROTATE');
    expect(classifyRefreshCredential(credential({ status: 'USED' }), now)).toBe('REUSE');
    expect(classifyRefreshCredential(credential({ status: 'REVOKED' }), now)).toBe('INVALID');
    expect(
      classifyRefreshCredential(
        credential({ session: { ...credential().session, status: 'COMPROMISED' } }),
        now,
      ),
    ).toBe('INVALID');
  });
});
