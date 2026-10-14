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
it('retains organization onboarding without accepting lookalike external or unsupported paths', () => {
  expect(safeReturnTo('/organizations/new')).toBe('/organizations/new');
  expect(safeReturnTo('/organizations/new/')).toBe('/organizations/new/');
  for (const path of [
    '//evil.test/organizations/new',
    '/organizations/new/extra',
    '/organizations/newish',
  ])
    expect(safeReturnTo(path)).toBe('/session');
});
