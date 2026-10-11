import { createHash, randomBytes } from 'node:crypto';

export function generateInvitationToken() {
  return randomBytes(32).toString('base64url');
}

export function hashInvitationToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
