import {
  ASSIGNABLE_MEMBERSHIP_ROLES,
  canTargetMembership,
  isRecentlyAuthenticated,
} from './membership-policy.js';

describe('membership policy', () => {
  it('protects Owner from ordinary commands and never makes Owner assignable', () => {
    expect(ASSIGNABLE_MEMBERSHIP_ROLES).not.toContain('OWNER');
    expect(canTargetMembership('OWNER', 'OWNER')).toBe(false);
    expect(canTargetMembership('ADMIN', 'OWNER')).toBe(false);
    expect(canTargetMembership('ADMIN', 'ACCOUNTANT')).toBe(true);
  });

  it('requires recent authentication for ownership transfer', () => {
    const now = new Date('2026-09-27T12:00:00.000Z');
    expect(isRecentlyAuthenticated(new Date('2026-09-27T11:50:00.000Z'), now)).toBe(true);
    expect(isRecentlyAuthenticated(new Date('2026-09-27T11:44:59.000Z'), now)).toBe(false);
    expect(isRecentlyAuthenticated(undefined, now)).toBe(false);
  });
});
