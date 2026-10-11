import { randomUUID } from 'node:crypto';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
export function resolveRequestId(value) {
  const candidate = typeof value === 'string' ? value : undefined;
  if (candidate !== undefined && candidate.length <= 64 && isAcceptedRequestId(candidate))
    return { requestId: candidate, source: 'external' };
  return { requestId: randomUUID(), source: 'generated' };
}
function isAcceptedRequestId(value) {
  return UUID_PATTERN.test(value) || ULID_PATTERN.test(value);
}
