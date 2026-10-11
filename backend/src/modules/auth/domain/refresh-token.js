import { createHash, randomBytes } from 'node:crypto';

export function generateRefreshToken() {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function classifyRefreshCredential(token, now = new Date()) {
  if (!token) return 'INVALID';
  if (token.status === 'USED') return 'REUSE';
  const session = token.session;
  if (
    token.status !== 'ACTIVE' ||
    token.expiresAt <= now ||
    session.status !== 'ACTIVE' ||
    session.expiresAt <= now ||
    session.user.status !== 'ACTIVE'
  ) {
    return 'INVALID';
  }
  return 'ROTATE';
}
