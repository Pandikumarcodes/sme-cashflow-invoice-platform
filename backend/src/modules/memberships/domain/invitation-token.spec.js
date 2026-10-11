import { generateInvitationToken, hashInvitationToken } from './invitation-token.js';

describe('invitation tokens', () => {
  it('generates distinct 256-bit base64url credentials and deterministic SHA-256 hashes', () => {
    const first = generateInvitationToken();
    const second = generateInvitationToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    expect(hashInvitationToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashInvitationToken(first)).toBe(hashInvitationToken(first));
    expect(hashInvitationToken(first)).not.toContain(first);
  });
});
