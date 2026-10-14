import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { grants, permissions } from './permissions';
import { parseOrganizations } from './contracts';
import { safeReturnTo } from '../auth/return-to';
// Contract parity is checked against source, without importing backend code into the bundle.
it('keeps the canonical permission catalog aligned with the backend', () => {
  const source = readFileSync('../backend/src/common/authorization/permissions.js', 'utf8');
  const canonical = [...source.matchAll(/: '([^']+)'/g)].map((match) => match[1]);
  expect([...permissions].sort()).toEqual(canonical.sort());
});
it('matches every backend role grant exactly', () => {
  const constants = readFileSync(
    '../backend/src/common/authorization/permissions.js',
    'utf8',
  ).replaceAll('export ', '');
  const roles = readFileSync('../backend/src/common/authorization/role-permissions.js', 'utf8')
    .replace(/^import .*;\r?\n/, '')
    .replaceAll('export ', '');
  const canonical = runInNewContext(`${constants}\n${roles}\nROLE_PERMISSIONS`) as Map<
    string,
    Set<string>
  >;
  for (const [role, expected] of canonical)
    expect([...grants(role, true)].sort()).toEqual([...expected].sort());
});
it.each(['UNKNOWN', '__proto__', 'constructor'])('fails closed for unknown role %s', (role) =>
  expect(grants(role, true)).toEqual([]),
);
it('does not grant inactive membership permissions', () =>
  expect(grants('OWNER', false)).toEqual([]));
it('preserves canonical role distinctions', () => {
  expect(grants('OWNER', true)).toContain('organization.close');
  expect(grants('ADMIN', true)).not.toContain('organization.close');
  expect(grants('ACCOUNTANT', true)).toContain('payment.reverse');
  expect(grants('ACCOUNTANT', true)).not.toContain('membership.invite');
  expect(grants('MEMBER', true)).toContain('invoice.issue');
  expect(grants('MEMBER', true)).not.toContain('invoice.cancel');
  expect(grants('VIEWER', true)).not.toContain('payment.read');
});
it('rejects undocumented pagination rather than treating a first page as complete', () => {
  expect(() => parseOrganizations({ data: [], meta: { hasNextPage: true } })).toThrow(
    'could not be verified',
  );
});
it('allows only implemented organization destinations after sign-in', () => {
  const scoped = '/organizations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/workspace';
  expect(safeReturnTo(scoped)).toBe(scoped);
  expect(safeReturnTo('/workspace')).toBe('/workspace');
  expect(safeReturnTo('/organizations/invalid/workspace')).toBe('/session');
  expect(safeReturnTo('/organizations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/reports')).toBe(
    '/organizations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/reports',
  );
});
