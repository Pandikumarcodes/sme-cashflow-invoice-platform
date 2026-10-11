import { expect, it } from 'vitest';
import { safeReturnTo } from './return-to';
it.each([
  'https://evil.test',
  '//evil.test/session',
  '/\\evil.test',
  '/login',
  '/session/../login',
  '/%2f%2fevil.test',
  '/session\n',
  { path: '/session' },
])('rejects unsafe destination %j', (value) => {
  expect(safeReturnTo(value)).toBe('/session');
});
it('retains a valid local protected destination', () => {
  expect(safeReturnTo('/session?view=account#ready')).toBe('/session?view=account#ready');
});
