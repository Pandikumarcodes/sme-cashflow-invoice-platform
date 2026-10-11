export const OWNER_ROLE = 'OWNER';

export const ASSIGNABLE_MEMBERSHIP_ROLES = Object.freeze([
  'ADMIN',
  'ACCOUNTANT',
  'MEMBER',
  'VIEWER',
]);

export function canTargetMembership(actorRole, targetRole) {
  return [OWNER_ROLE, 'ADMIN'].includes(actorRole) && !isOwnerRole(targetRole);
}

export function isOwnerRole(role) {
  return role === OWNER_ROLE;
}

export function isRecentlyAuthenticated(authenticatedAt, now = new Date()) {
  if (!(authenticatedAt instanceof Date) || Number.isNaN(authenticatedAt.getTime())) return false;
  const age = now.getTime() - authenticatedAt.getTime();
  return age >= -5_000 && age <= 15 * 60 * 1_000;
}
