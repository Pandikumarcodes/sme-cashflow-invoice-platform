import type { Session } from '../../auth/session';
import { parseAuditPage, type AuditFilters } from './contracts';
export async function listAudit(
  session: Session,
  org: string,
  filters: AuditFilters,
  after: string | undefined,
  signal: AbortSignal,
) {
  const query: Record<string, string | number | undefined> = {
    limit: filters.limit,
    sortBy: 'occurredAt',
    sortOrder: filters.sortOrder,
    after,
  };
  for (const field of [
    'actorUserId',
    'action',
    'entityType',
    'entityId',
    'occurredFrom',
    'occurredTo',
  ] as const)
    if (filters[field]) query[field] = filters[field];
  return parseAuditPage(
    (await session.request(`/organizations/${org}/audit-logs`, { query, signal })).body,
    org,
    filters,
  );
}
